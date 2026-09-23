import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../../common/errors/app.exception.js';
import type { Env } from '../../../config/env.validation.js';

export class EvolutionUnavailableError extends AppException {
  constructor(message = 'Evolution API is not configured') {
    super('EVOLUTION_UNAVAILABLE', message, 503);
  }
}

export class EvolutionRequestError extends AppException {
  constructor(
    message = 'Evolution API request failed',
    readonly httpStatus?: number,
  ) {
    super('EVOLUTION_REQUEST_FAILED', message, 502);
  }
}

export interface EvolutionConnectionState {
  instance: string;
  state: string;
}

export interface EvolutionSendResult {
  externalMessageId?: string;
  raw: unknown;
}

export type EvolutionMediaType = 'image' | 'video' | 'document' | 'audio';

export interface EvolutionSendMediaInput {
  number: string;
  mediatype: EvolutionMediaType;
  media: string;
  fileName?: string;
  caption?: string;
  mimetype?: string;
}

export interface EvolutionMediaMessageKey {
  id: string;
  remoteJid: string;
  fromMe?: boolean;
}

export interface EvolutionMediaContent {
  base64: string;
  mimeType: string | null;
  fileName: string | null;
  caption: string | null;
  size: number | null;
}

@Injectable()
export class EvolutionClient {
  private readonly logger = new Logger(EvolutionClient.name);
  private readonly baseUrl?: string;
  private readonly apiKey?: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = trimTrailingSlash(config.get('EVOLUTION_API_BASE_URL') ?? '');
    this.apiKey = config.get('EVOLUTION_API_KEY');
  }

  get configured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async getConnectionState(instanceName: string): Promise<EvolutionConnectionState> {
    const response = await this.request('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const data = response as { instance?: { instanceName?: string; state?: string } };
    return {
      instance: data.instance?.instanceName ?? instanceName,
      state: data.instance?.state ?? 'unknown',
    };
  }

  async createInstance(instanceName: string): Promise<unknown> {
    return this.request('POST', '/instance/create', {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    });
  }

  async connect(instanceName: string): Promise<unknown> {
    return this.request('GET', `/instance/connect/${encodeURIComponent(instanceName)}`);
  }

  async disconnect(instanceName: string): Promise<unknown> {
    return this.request('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  async setWebhook(instanceName: string, url: string, events: string[]): Promise<unknown> {
    return this.request('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: { enabled: true, url, events, base64: false },
    });
  }

  async sendText(instanceName: string, number: string, text: string): Promise<EvolutionSendResult> {
    const raw = await this.request('POST', `/message/sendText/${encodeURIComponent(instanceName)}`, {
      number,
      text,
    });

    return { externalMessageId: extractMessageId(raw), raw };
  }

  async sendWhatsAppAudio(
    instanceName: string,
    input: { number: string; audio: string },
  ): Promise<EvolutionSendResult> {
    const raw = await this.request(
      'POST',
      `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
      { number: input.number, audio: input.audio },
    );

    return { externalMessageId: extractMessageId(raw), raw };
  }

  async sendMedia(
    instanceName: string,
    input: EvolutionSendMediaInput,
  ): Promise<EvolutionSendResult> {
    const raw = await this.request('POST', `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      mediatype: input.mediatype,
      media: input.media,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.caption ? { caption: input.caption } : {}),
      ...(input.mimetype ? { mimetype: input.mimetype } : {}),
    });

    return { externalMessageId: extractMessageId(raw), raw };
  }

  async getBase64FromMediaMessage(
    instanceName: string,
    key: EvolutionMediaMessageKey,
  ): Promise<EvolutionMediaContent> {
    const raw = await this.request(
      'POST',
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      {
        message: {
          key: { id: key.id, remoteJid: key.remoteJid, fromMe: key.fromMe ?? false },
        },
      },
    );

    const record = isRecord(raw) ? raw : {};
    const base64 = readString(record.base64);
    if (!base64) {
      throw new EvolutionRequestError('Media content not available for this message');
    }

    const size = isRecord(record) && typeof record.size === 'number' ? record.size : null;

    return {
      base64,
      mimeType: readString(record.mimetype) ?? readString(record.mimeType),
      fileName: readString(record.fileName),
      caption: readString(record.caption),
      size,
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!this.baseUrl || !this.apiKey) {
      throw new EvolutionUnavailableError();
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          apikey: this.apiKey,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        throw new EvolutionRequestError(
          `Evolution API responded with status ${response.status}`,
          response.status,
        );
      }

      if (response.status === 204) {
        return null;
      }

      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this.logger.warn(`Evolution request failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new EvolutionRequestError();
    }
  }
}

function extractMessageId(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const record = raw as { key?: { id?: unknown }; id?: unknown };
  if (typeof record.key?.id === 'string') {
    return record.key.id;
  }
  if (typeof record.id === 'string') {
    return record.id;
  }
  return undefined;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
