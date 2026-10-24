import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../../common/errors/app.exception.js';
import type { Env } from '../../../config/env.validation.js';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service.js';

export class EvolutionUnavailableError extends AppException {
  constructor(message = 'Evolution API is not configured') {
    super('EVOLUTION_UNAVAILABLE', message, 503);
  }
}

export class EvolutionRequestError extends AppException {
  constructor(
    message = 'Evolution API request failed',
    readonly httpStatus?: number,
    options?: { cause?: unknown },
  ) {
    super('EVOLUTION_REQUEST_FAILED', message, 502);
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export interface EvolutionConnectionState {
  instance: string;
  state: string;
}

export interface EvolutionHistoryMessagesQuery {
  from: Date;
  to: Date;
  page: number;
  limit: number;
}

export interface EvolutionHistoryMessagesPage {
  total: number;
  pages: number;
  records: Record<string, unknown>[];
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
  quoted?: EvolutionQuotedMessage;
}

export interface EvolutionQuotedMessage {
  key: { id: string; remoteJid: string; fromMe: boolean; participant?: string };
  message: Record<string, unknown>;
}

export interface EvolutionMediaMessageKey {
  id: string;
  remoteJid: string;
  fromMe?: boolean;
}

export interface EvolutionUpdateMessageInput {
  number: string;
  key: { id: string; remoteJid: string; fromMe: boolean };
  text: string;
}

export interface EvolutionMediaContent {
  base64: string;
  mimeType: string | null;
  fileName: string | null;
  caption: string | null;
  size: number | null;
}

export interface EvolutionGroupInfo {
  groupJid: string;
  subject: string | null;
  pictureUrl: string | null;
  size: number | null;
}

export interface EvolutionContact {
  jid: string;
  name: string | null;
  avatarUrl: string | null;
}

@Injectable()
export class EvolutionClient {
  private readonly logger = new Logger(EvolutionClient.name);
  private readonly baseUrl?: string;
  private readonly apiKey?: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly platformSettings: PlatformSettingsService,
  ) {
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

  async deleteInstance(instanceName: string): Promise<unknown> {
    return this.request('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
  }

  async findMessages(
    instanceName: string,
    query: EvolutionHistoryMessagesQuery,
  ): Promise<EvolutionHistoryMessagesPage> {
    const raw = await this.request(
      'POST',
      `/chat/findMessages/${encodeURIComponent(instanceName)}`,
      {
        where: {
          messageTimestamp: {
            gte: query.from.toISOString(),
            lte: query.to.toISOString(),
          },
        },
        page: query.page,
        offset: query.limit,
      },
    );

    const data = isRecord(raw) && isRecord(raw.messages) ? raw.messages : null;
    const records = data && Array.isArray(data.records) ? data.records.filter(isRecord) : [];

    return {
      total: data && typeof data.total === 'number' ? data.total : records.length,
      pages: data && typeof data.pages === 'number' ? data.pages : 1,
      records,
    };
  }

  async instanceExists(instanceName: string): Promise<boolean> {
    const raw = await this.request('GET', '/instance/fetchInstances');
    const list = Array.isArray(raw)
      ? raw
      : isRecord(raw) && Array.isArray(raw.data)
        ? raw.data
        : [];

    return list.some(
      (entry) =>
        isRecord(entry) &&
        (entry.name === instanceName || entry.instanceName === instanceName),
    );
  }

  async setWebhook(instanceName: string, url: string, events: string[]): Promise<unknown> {
    return this.request('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: { enabled: true, url, events, base64: false },
    });
  }

  async sendText(
    instanceName: string,
    number: string,
    text: string,
    quoted?: EvolutionQuotedMessage,
    options?: { linkPreview?: boolean },
  ): Promise<EvolutionSendResult> {
    const linkPreviewsEnabled = await this.platformSettings.isLinkPreviewsEnabled();
    const linkPreview = linkPreviewsEnabled ? options?.linkPreview : false;

    const raw = await this.request(
      'POST',
      `/message/sendText/${encodeURIComponent(instanceName)}`,
      {
        number,
        text,
        ...(quoted ? { quoted } : {}),
        ...(linkPreview !== undefined ? { linkPreview } : {}),
      },
    );

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

  /**
   * Edits an already sent message through Evolution's `chat/updateMessage`
   * endpoint (Evolution v2.x). The provider resolves the original message by the
   * supplied key, so the whole key and the destination number are mandatory. The
   * provider only supports text bodies and image/video captions.
   */
  async updateMessage(
    instanceName: string,
    input: EvolutionUpdateMessageInput,
  ): Promise<unknown> {
    return this.request('POST', `/chat/updateMessage/${encodeURIComponent(instanceName)}`, {
      number: input.number,
      key: {
        id: input.key.id,
        remoteJid: input.key.remoteJid,
        fromMe: input.key.fromMe,
      },
      text: input.text,
    });
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
      ...(input.quoted ? { quoted: input.quoted } : {}),
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

  async findGroupInfos(instanceName: string, groupJid: string): Promise<EvolutionGroupInfo | null> {
    const raw = await this.request(
      'GET',
      `/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
    );

    if (!isRecord(raw)) {
      return null;
    }

    const subject = readString(raw.subject) ?? readString(raw.name);
    const pictureUrl =
      readString(raw.pictureUrl) ?? readString(raw.profilePictureUrl) ?? readString(raw.avatar);
    const size = typeof raw.size === 'number' ? raw.size : null;

    return {
      groupJid: readString(raw.id) ?? readString(raw.groupJid) ?? groupJid,
      subject,
      pictureUrl,
      size,
    };
  }

  /**
   * Lists the groups available to an instance. Evolution v2 exposes
   * `GET /group/fetchAllGroups/:instanceName`; older/newer builds may wrap the
   * array in `groups` or `data`, so both shapes are accepted.
   */
  async findGroups(instanceName: string): Promise<EvolutionGroupInfo[]> {
    const raw = await this.request(
      'GET',
      `/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,
    );

    const list = Array.isArray(raw)
      ? raw
      : isRecord(raw) && Array.isArray(raw.groups)
        ? raw.groups
        : isRecord(raw) && Array.isArray(raw.data)
          ? raw.data
          : [];

    return list.filter(isRecord).flatMap((entry) => {
      const groupJid = readString(entry.id) ?? readString(entry.groupJid) ?? readString(entry.jid);
      if (!groupJid || !groupJid.endsWith('@g.us')) {
        return [];
      }
      const subject = readString(entry.subject) ?? readString(entry.name);
      const pictureUrl =
        readString(entry.pictureUrl) ??
        readString(entry.profilePictureUrl) ??
        readString(entry.avatar);
      const size = typeof entry.size === 'number' ? entry.size : null;

      return [{ groupJid, subject, pictureUrl, size }];
    });
  }

  /** Address book of the connected number, used to import contacts into the CRM. */
  async findContacts(instanceName: string): Promise<EvolutionContact[]> {
    const raw = await this.request(
      'POST',
      `/chat/findContacts/${encodeURIComponent(instanceName)}`,
      {},
    );

    const list = Array.isArray(raw)
      ? raw
      : isRecord(raw) && Array.isArray(raw.contacts)
        ? raw.contacts
        : [];

    return list.filter(isRecord).flatMap((entry) => {
      const jid = readString(entry.remoteJid) ?? readString(entry.id);
      if (!jid) {
        return [];
      }
      return [
        {
          jid,
          name:
            readString(entry.pushName) ??
            readString(entry.name) ??
            readString(entry.verifiedName) ??
            readString(entry.notify),
          avatarUrl: readString(entry.profilePicUrl) ?? readString(entry.profilePictureUrl),
        },
      ];
    });
  }

  async fetchProfilePictureUrl(instanceName: string, jid: string): Promise<string | null> {
    const raw = await this.request(
      'POST',
      `/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`,
      { number: jid },
    );

    if (!isRecord(raw)) {
      return null;
    }

    return readString(raw.profilePictureUrl) ?? readString(raw.pictureUrl) ?? readString(raw.url);
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
      throw new EvolutionRequestError('Evolution API request failed', undefined, { cause: error });
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
