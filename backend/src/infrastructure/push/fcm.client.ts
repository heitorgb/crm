import { createSign } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';

export interface PushMessage {
  title: string;
  body: string;
  /** Notifications sharing a tag replace each other on the device. */
  tag: string;
  data: Record<string, string>;
}

export type PushDeliveryResult = 'sent' | 'invalid-token' | 'failed';

interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

interface CachedAccessToken {
  value: string;
  expiresAt: number;
}

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const ASSERTION_LIFETIME_SECONDS = 3600;
const ACCESS_TOKEN_RENEW_MARGIN_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
export const ANDROID_MESSAGES_CHANNEL_ID = 'messages';

const INVALID_TOKEN_ERROR_CODES = new Set(['UNREGISTERED', 'SENDER_ID_MISMATCH']);

/**
 * Minimal Firebase Cloud Messaging HTTP v1 client. It signs the service-account
 * assertion with node:crypto instead of pulling in firebase-admin, since only
 * single-device sends are needed.
 */
@Injectable()
export class FcmClient {
  private readonly logger = new Logger(FcmClient.name);
  private readonly credentials: FcmCredentials | null;
  private accessToken: CachedAccessToken | null = null;
  private accessTokenRequest: Promise<string> | null = null;

  constructor(config: ConfigService<Env, true>) {
    const projectId = config.get('FCM_PROJECT_ID');
    const clientEmail = config.get('FCM_CLIENT_EMAIL');
    const privateKey = config.get('FCM_PRIVATE_KEY');

    this.credentials =
      projectId && clientEmail && privateKey
        ? { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }
        : null;
  }

  isConfigured(): boolean {
    return this.credentials !== null;
  }

  async send(deviceToken: string, message: PushMessage): Promise<PushDeliveryResult> {
    const credentials = this.credentials;
    if (!credentials) {
      return 'failed';
    }

    let accessToken: string;
    try {
      accessToken = await this.getAccessToken(credentials);
    } catch (error) {
      this.logger.warn(`FCM authentication failed: ${errorMessage(error)}`);
      return 'failed';
    }

    let response: Response;
    try {
      response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: buildFcmMessage(deviceToken, message) }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      this.logger.warn(`FCM request failed: ${errorMessage(error)}`);
      return 'failed';
    }

    if (response.ok) {
      return 'sent';
    }

    if (response.status === 401) {
      this.accessToken = null;
    }

    const errorCode = await readFcmErrorCode(response);
    if (response.status === 404 || (errorCode && INVALID_TOKEN_ERROR_CODES.has(errorCode))) {
      return 'invalid-token';
    }

    this.logger.warn(`FCM send failed with status ${response.status} (${errorCode ?? 'unknown'})`);
    return 'failed';
  }

  private async getAccessToken(credentials: FcmCredentials): Promise<string> {
    if (
      this.accessToken &&
      this.accessToken.expiresAt - ACCESS_TOKEN_RENEW_MARGIN_MS > Date.now()
    ) {
      return this.accessToken.value;
    }

    this.accessTokenRequest ??= this.requestAccessToken(credentials).finally(() => {
      this.accessTokenRequest = null;
    });
    return this.accessTokenRequest;
  }

  private async requestAccessToken(credentials: FcmCredentials): Promise<string> {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signAssertion(credentials),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`token endpoint returned ${response.status}`);
    }

    const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string') {
      throw new Error('token endpoint returned no access token');
    }

    const expiresInSeconds =
      typeof payload.expires_in === 'number' ? payload.expires_in : ASSERTION_LIFETIME_SECONDS;
    this.accessToken = {
      value: payload.access_token,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    };
    return payload.access_token;
  }
}

function buildFcmMessage(deviceToken: string, message: PushMessage): Record<string, unknown> {
  return {
    token: deviceToken,
    notification: { title: message.title, body: message.body },
    data: message.data,
    android: {
      priority: 'HIGH',
      notification: {
        tag: message.tag,
        channel_id: ANDROID_MESSAGES_CHANNEL_ID,
        default_sound: true,
      },
    },
  };
}

function signAssertion(credentials: FcmCredentials): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: FCM_SCOPE,
      aud: OAUTH_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(credentials.privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

async function readFcmErrorCode(response: Response): Promise<string | null> {
  const payload = (await response.json().catch(() => null)) as {
    error?: { status?: unknown; details?: Array<{ errorCode?: unknown }> };
  } | null;
  const detailCode = payload?.error?.details?.find(
    (detail) => typeof detail.errorCode === 'string',
  )?.errorCode;
  if (typeof detailCode === 'string') {
    return detailCode;
  }
  return typeof payload?.error?.status === 'string' ? payload.error.status : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown';
}
