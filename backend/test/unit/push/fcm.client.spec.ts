import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import { FcmClient, type PushMessage } from '../../../src/infrastructure/push/fcm.client.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const MESSAGE: PushMessage = {
  title: 'Maria',
  body: 'Olá!',
  tag: 'conversation-1',
  data: {
    conversationId: 'conversation-1',
    path: '/atendimento/conversas?conversation=conversation-1',
  },
};

function createClient(values: Partial<Record<keyof Env, string>> = {}): FcmClient {
  const config = { get: vi.fn((key: keyof Env) => values[key]) };
  return new FcmClient(config as unknown as ConfigService<Env, true>);
}

function configuredClient(): FcmClient {
  return createClient({
    FCM_PROJECT_ID: 'orderup-test',
    FCM_CLIENT_EMAIL: 'push@orderup-test.iam.gserviceaccount.com',
    FCM_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('FcmClient', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is not configured and sends nothing without credentials', async () => {
    const client = createClient();

    expect(client.isConfigured()).toBe(false);
    await expect(client.send('device-token', MESSAGE)).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs a service-account assertion and sends an Android notification', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'access-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'projects/orderup-test/messages/1' }));

    const result = await configuredClient().send('device-token', MESSAGE);

    expect(result).toBe('sent');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(String(tokenInit?.body)).get('assertion')!;
    const [header, claims, signature] = assertion.split('.');
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, signature!, 'base64url');
    expect(verified).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      iss: 'push@orderup-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1]!;
    expect(sendUrl).toBe('https://fcm.googleapis.com/v1/projects/orderup-test/messages:send');
    expect(new Headers(sendInit?.headers).get('Authorization')).toBe('Bearer access-1');
    expect(JSON.parse(String(sendInit?.body))).toEqual({
      message: {
        token: 'device-token',
        notification: { title: 'Maria', body: 'Olá!' },
        data: MESSAGE.data,
        android: {
          priority: 'HIGH',
          notification: { tag: 'conversation-1', channel_id: 'messages', default_sound: true },
        },
      },
    });
  });

  it('reuses the access token across sends', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'access-1', expires_in: 3600 }))
      .mockResolvedValue(jsonResponse(200, {}));
    const client = configuredClient();

    await client.send('device-a', MESSAGE);
    await client.send('device-b', MESSAGE);

    const tokenRequests = fetchMock.mock.calls.filter(
      ([url]) => url === 'https://oauth2.googleapis.com/token',
    );
    expect(tokenRequests).toHaveLength(1);
  });

  it('reports unregistered tokens as invalid', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'access-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse(404, {
          error: {
            status: 'NOT_FOUND',
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'UNREGISTERED',
              },
            ],
          },
        }),
      );

    await expect(configuredClient().send('stale-token', MESSAGE)).resolves.toBe('invalid-token');
  });

  it('keeps the token on transient failures', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'access-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(503, { error: { status: 'UNAVAILABLE' } }));

    await expect(configuredClient().send('device-token', MESSAGE)).resolves.toBe('failed');
  });

  it('fails without sending when authentication is rejected', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }));

    await expect(configuredClient().send('device-token', MESSAGE)).resolves.toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
