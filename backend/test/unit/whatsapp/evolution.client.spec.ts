import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import { EvolutionClient } from '../../../src/modules/whatsapp/evolution/evolution.client.js';
import type { PlatformSettingsService } from '../../../src/modules/platform-settings/platform-settings.service.js';

interface PlatformSettingsMock {
  isLinkPreviewsEnabled: ReturnType<typeof vi.fn>;
}

function createClient(): {
  client: EvolutionClient;
  platformSettings: PlatformSettingsMock;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const config = {
    get: (key: string) =>
      key === 'EVOLUTION_API_BASE_URL'
        ? 'http://evolution.local'
        : key === 'EVOLUTION_API_KEY'
          ? 'secret'
          : undefined,
  } as unknown as ConfigService<Env, true>;
  const platformSettings: PlatformSettingsMock = {
    isLinkPreviewsEnabled: vi.fn().mockResolvedValue(false),
  };
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ key: { id: 'external-1' } }),
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    client: new EvolutionClient(config, platformSettings as unknown as PlatformSettingsService),
    platformSettings,
    fetchMock,
  };
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EvolutionClient.sendText link preview', () => {
  it('forces linkPreview false when the global setting is disabled', async () => {
    const { client, fetchMock } = createClient();

    await client.sendText('instance-1', '5511999999999', 'Veja https://exemplo.com', undefined, {
      linkPreview: true,
    });

    expect(sentBody(fetchMock)).toEqual({
      number: '5511999999999',
      text: 'Veja https://exemplo.com',
      linkPreview: false,
    });
  });

  it('allows the preview when globally enabled and the caller asks for it', async () => {
    const { client, platformSettings, fetchMock } = createClient();
    platformSettings.isLinkPreviewsEnabled.mockResolvedValue(true);

    await client.sendText('instance-1', '5511999999999', 'Veja https://exemplo.com', undefined, {
      linkPreview: true,
    });

    expect(sentBody(fetchMock)).toMatchObject({ linkPreview: true });
  });

  it('keeps an explicit per-message suppression when globally enabled', async () => {
    const { client, platformSettings, fetchMock } = createClient();
    platformSettings.isLinkPreviewsEnabled.mockResolvedValue(true);

    await client.sendText('instance-1', '5511999999999', 'Veja https://exemplo.com', undefined, {
      linkPreview: false,
    });

    expect(sentBody(fetchMock)).toMatchObject({ linkPreview: false });
  });

  it('omits the option when globally enabled and the caller has no preference', async () => {
    const { client, platformSettings, fetchMock } = createClient();
    platformSettings.isLinkPreviewsEnabled.mockResolvedValue(true);

    await client.sendText('instance-1', '5511999999999', 'Olá');

    expect(sentBody(fetchMock)).not.toHaveProperty('linkPreview');
  });
});

describe('EvolutionClient.getConnectionState', () => {
  it('distinguishes a valid open state', async () => {
    const { client, fetchMock } = createClient();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ instance: { instanceName: 'inst-1', state: 'open' } }),
    });

    await expect(client.getConnectionState('inst-1')).resolves.toEqual({
      instance: 'inst-1',
      state: 'open',
      kind: 'confirmed',
    });
  });

  it('marks an unknown state as inconclusive instead of close', async () => {
    const { client, fetchMock } = createClient();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ instance: { instanceName: 'inst-1' } }),
    });

    await expect(client.getConnectionState('inst-1')).resolves.toEqual({
      instance: 'inst-1',
      state: 'unknown',
      kind: 'invalid',
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ instance: { instanceName: 'inst-1', state: 'maintenance' } }),
    });

    await expect(client.getConnectionState('inst-1')).resolves.toEqual({
      instance: 'inst-1',
      state: 'maintenance',
      kind: 'unknown',
    });
  });

  it('reports a missing instance as not_found', async () => {
    const { client, fetchMock } = createClient();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

    await expect(client.getConnectionState('inst-1')).resolves.toEqual({
      instance: 'inst-1',
      state: 'unknown',
      kind: 'not_found',
    });
  });

  it('propagates communication failures instead of inventing a state', async () => {
    const { client, fetchMock } = createClient();
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(client.getConnectionState('inst-1')).rejects.toMatchObject({
      code: 'EVOLUTION_REQUEST_FAILED',
    });
  });
});

describe('EvolutionClient.fetchInstances', () => {
  it('reads the session owner from v2 and v1 payload shapes', async () => {
    const { client, fetchMock } = createClient();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { name: 'inst-v2', connectionStatus: 'open', ownerJid: '5511999999999@s.whatsapp.net' },
        { instance: { instanceName: 'inst-v1', status: 'connecting', owner: '5511888888888@s.whatsapp.net' } },
        { connectionStatus: 'open' },
      ],
    });

    await expect(client.fetchInstances()).resolves.toEqual([
      { name: 'inst-v2', state: 'open', ownerJid: '5511999999999@s.whatsapp.net' },
      { name: 'inst-v1', state: 'connecting', ownerJid: '5511888888888@s.whatsapp.net' },
    ]);
  });
});

describe('EvolutionClient provider error details', () => {
  it('keeps the provider reason for logs, masks phone numbers and keeps the public message', async () => {
    const { client, fetchMock } = createClient();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          status: 400,
          error: 'Bad Request',
          response: { message: ['Connection Closed', 'jid 5511999999999 not on WhatsApp'] },
        }),
    });

    await expect(client.sendText('instance-1', '5511999999999', 'oi')).rejects.toMatchObject({
      httpStatus: 400,
      message: 'Evolution API responded with status 400',
      providerMessage: 'Connection Closed; jid <number> not on WhatsApp',
    });
  });

  it('tolerates an error response without a readable body', async () => {
    const { client, fetchMock } = createClient();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error('stream aborted');
      },
    });

    await expect(client.sendText('instance-1', '5511999999999', 'oi')).rejects.toMatchObject({
      httpStatus: 500,
      providerMessage: null,
    });
  });
});
