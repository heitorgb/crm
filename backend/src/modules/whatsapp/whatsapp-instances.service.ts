import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WhatsAppInstanceStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EvolutionClient, EvolutionRequestError } from './evolution/evolution.client.js';
import type {
  CreateWhatsAppInstanceDto,
  ListWhatsAppInstancesQueryDto,
  UpdateWhatsAppInstanceDto,
  WhatsAppCredentialsDto,
} from './dto/whatsapp-instance.dto.js';
import {
  WhatsAppInstanceNameConflictError,
  WhatsAppInstanceNotFoundError,
} from './whatsapp.errors.js';

export interface WhatsAppInstanceView {
  id: string;
  name: string;
  instanceName: string;
  externalInstanceId: string | null;
  phone: string | null;
  status: WhatsAppInstanceStatus;
  active: boolean;
  hasCredentials: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppConnectionTicket {
  status: WhatsAppInstanceStatus;
  qrCodeBase64: string | null;
  pairingCode: string | null;
  code: string | null;
}

export interface WhatsAppWebhookResult {
  webhookConfigured: boolean;
  webhookUrl: string;
}

export interface ResolvedInstance {
  id: string;
  tenantId: string;
  instanceName: string;
  status: WhatsAppInstanceStatus;
}

const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'GROUPS_UPSERT', 'PRESENCE_UPDATE'];

@Injectable()
export class WhatsAppInstancesService {
  private readonly logger = new Logger(WhatsAppInstancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly encryption: EncryptionService,
    private readonly evolution: EvolutionClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(query: ListWhatsAppInstancesQueryDto): Promise<PageResult<WhatsAppInstanceView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.WhatsAppInstanceWhereInput = { tenantId };

    if (query.status) where.status = query.status;
    if (query.active !== undefined) where.active = query.active;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { instanceName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, instances] = await this.prisma.$transaction([
      this.prisma.whatsAppInstance.count({ where }),
      this.prisma.whatsAppInstance.findMany({
        where,
        orderBy: { createdAt: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
      }),
    ]);

    return buildPage(instances.map(toView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<WhatsAppInstanceView> {
    const { tenantId } = this.tenantContext.requireContext();
    const instance = await this.prisma.whatsAppInstance.findFirst({ where: { id, tenantId } });

    if (!instance) {
      throw new WhatsAppInstanceNotFoundError();
    }

    return toView(instance);
  }

  async create(dto: CreateWhatsAppInstanceDto): Promise<WhatsAppInstanceView> {
    const { tenantId } = this.tenantContext.requireContext();

    try {
      const instance = await this.prisma.whatsAppInstance.create({
        data: {
          tenantId,
          name: dto.name.trim(),
          instanceName: dto.instanceName.trim(),
          phone: normalizeNullableString(dto.phone),
          active: dto.active ?? true,
          credentialsEncrypted: this.encryptCredentials(dto.credentials),
        },
      });
      return toView(instance);
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  async update(id: string, dto: UpdateWhatsAppInstanceDto): Promise<WhatsAppInstanceView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireInstance(tenantId, id);

    const data: Prisma.WhatsAppInstanceUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = normalizeNullableString(dto.phone);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.credentials !== undefined) {
      data.credentialsEncrypted = this.encryptCredentials(dto.credentials);
    }

    try {
      const instance = await this.prisma.whatsAppInstance.update({ where: { id }, data });
      return toView(instance);
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.whatsAppInstance.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new WhatsAppInstanceNotFoundError();
    }
  }

  async connect(id: string): Promise<WhatsAppConnectionTicket> {
    const instance = await this.requireInstanceById(id);

    const raw = await this.ensureInstanceAndConnect(instance.instanceName);
    const ticket = extractConnectionTicket(raw);

    await this.prisma.whatsAppInstance.update({
      where: { id },
      data: { status: WhatsAppInstanceStatus.CONNECTING },
    });

    await this.tryConfigureWebhook(instance);

    return { status: WhatsAppInstanceStatus.CONNECTING, ...ticket };
  }

  async configureWebhook(id: string): Promise<WhatsAppWebhookResult> {
    const instance = await this.requireInstanceById(id);
    return this.configureWebhookForInstance(instance);
  }

  async disconnect(id: string): Promise<{ status: WhatsAppInstanceStatus }> {
    const instance = await this.requireInstanceById(id);
    await this.evolution.disconnect(instance.instanceName);
    const updated = await this.prisma.whatsAppInstance.update({
      where: { id },
      data: { status: WhatsAppInstanceStatus.DISCONNECTED },
    });
    return { status: updated.status };
  }

  async refreshStatus(id: string): Promise<{ status: WhatsAppInstanceStatus }> {
    const instance = await this.requireInstanceById(id);
    const state = await this.evolution.getConnectionState(instance.instanceName);
    const status = mapEvolutionState(state.state);
    const updated = await this.prisma.whatsAppInstance.update({
      where: { id },
      data: { status },
    });
    return { status: updated.status };
  }

  private async ensureInstanceAndConnect(instanceName: string): Promise<unknown> {
    try {
      // Create the instance in Evolution when it does not exist yet; the create
      // response already carries the QR code for a fresh instance.
      return await this.evolution.createInstance(instanceName);
    } catch (error) {
      if (
        error instanceof EvolutionRequestError &&
        (error.httpStatus === 409 || error.httpStatus === 400)
      ) {
        // Already exists: ask for a fresh connection ticket.
        return this.evolution.connect(instanceName);
      }
      throw error;
    }
  }

  private async tryConfigureWebhook(instance: {
    id: string;
    tenantId: string;
    instanceName: string;
    credentialsEncrypted: string | null;
  }): Promise<void> {
    try {
      await this.configureWebhookForInstance(instance);
    } catch (error) {
      this.logger.warn(
        `Could not configure webhook for instance ${instance.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private async configureWebhookForInstance(instance: {
    id: string;
    tenantId: string;
    instanceName: string;
    credentialsEncrypted: string | null;
  }): Promise<WhatsAppWebhookResult> {
    const publicUrl = this.config.get('PUBLIC_API_URL');
    if (!publicUrl) {
      throw new AppException(
        'PUBLIC_API_URL_MISSING',
        'PUBLIC_API_URL must be configured so Evolution can reach the webhook',
        409,
      );
    }

    const secret = this.resolveWebhookSecret(instance.credentialsEncrypted);
    const prefix = this.config.getOrThrow('API_PREFIX');
    const baseUrl = `${trimTrailingSlash(publicUrl)}/${prefix}/webhooks/evolution`;
    const webhookUrl = `${baseUrl}?token=${encodeURIComponent(secret)}`;

    await this.evolution.setWebhook(instance.instanceName, webhookUrl, WEBHOOK_EVENTS);

    // Never return the secret embedded in the URL.
    return { webhookConfigured: true, webhookUrl: baseUrl };
  }

  private resolveWebhookSecret(credentialsEncrypted: string | null): string {
    const globalSecret = this.config.get('EVOLUTION_WEBHOOK_SECRET');

    if (credentialsEncrypted && this.encryption.available) {
      try {
        const credentials = this.encryption.decryptJson<{ webhookSecret?: string | null }>(
          credentialsEncrypted,
        );
        if (credentials.webhookSecret) {
          return credentials.webhookSecret;
        }
      } catch {
        this.logger.warn('Could not decrypt instance credentials; using the global webhook secret');
      }
    }

    if (!globalSecret) {
      throw new AppException(
        'WEBHOOK_SECRET_MISSING',
        'No webhook secret available (instance credentials or EVOLUTION_WEBHOOK_SECRET)',
        409,
      );
    }

    return globalSecret;
  }

  /**
   * System lookup used by the public webhook, before a tenant context exists.
   * Resolution is always by the Evolution instance name, never by client payload.
   */
  async resolveByInstanceName(instanceName: string): Promise<ResolvedInstance | null> {
    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { instanceName },
      select: { id: true, tenantId: true, instanceName: true, status: true, active: true },
    });

    if (!instance || !instance.active) {
      return null;
    }

    return {
      id: instance.id,
      tenantId: instance.tenantId,
      instanceName: instance.instanceName,
      status: instance.status,
    };
  }

  private encryptCredentials(credentials?: WhatsAppCredentialsDto): string | null {
    if (!credentials || (credentials.apiKey === undefined && credentials.webhookSecret === undefined)) {
      return null;
    }

    return this.encryption.encryptJson({
      apiKey: credentials.apiKey ?? null,
      webhookSecret: credentials.webhookSecret ?? null,
    });
  }

  private async requireInstance(tenantId: string, id: string): Promise<void> {
    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!instance) {
      throw new WhatsAppInstanceNotFoundError();
    }
  }

  private async requireInstanceById(id: string) {
    const { tenantId } = this.tenantContext.requireContext();
    const instance = await this.prisma.whatsAppInstance.findFirst({ where: { id, tenantId } });
    if (!instance) {
      throw new WhatsAppInstanceNotFoundError();
    }
    return instance;
  }
}

function toView(instance: {
  id: string;
  name: string;
  instanceName: string;
  externalInstanceId: string | null;
  phone: string | null;
  status: WhatsAppInstanceStatus;
  active: boolean;
  credentialsEncrypted: string | null;
  createdAt: Date;
  updatedAt: Date;
}): WhatsAppInstanceView {
  return {
    id: instance.id,
    name: instance.name,
    instanceName: instance.instanceName,
    externalInstanceId: instance.externalInstanceId,
    phone: instance.phone,
    status: instance.status,
    active: instance.active,
    hasCredentials: Boolean(instance.credentialsEncrypted),
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  };
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapEvolutionState(state: string): WhatsAppInstanceStatus {
  const normalized = state.toLowerCase();
  if (normalized === 'open' || normalized === 'connected') {
    return WhatsAppInstanceStatus.CONNECTED;
  }
  if (normalized === 'connecting') {
    return WhatsAppInstanceStatus.CONNECTING;
  }
  if (normalized === 'close' || normalized === 'disconnected') {
    return WhatsAppInstanceStatus.DISCONNECTED;
  }
  return WhatsAppInstanceStatus.ERROR;
}

function mapNameConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new WhatsAppInstanceNameConflictError();
  }
  return error;
}

interface ConnectionTicketParts {
  qrCodeBase64: string | null;
  pairingCode: string | null;
  code: string | null;
}

/** Normalizes the different Evolution API connect/create payload shapes. */
function extractConnectionTicket(raw: unknown): ConnectionTicketParts {
  if (!isRecord(raw)) {
    return { qrCodeBase64: null, pairingCode: null, code: null };
  }

  const qrcode = isRecord(raw.qrcode) ? raw.qrcode : null;
  const base64 = readString(raw.base64) ?? (qrcode ? readString(qrcode.base64) : null);

  return {
    qrCodeBase64: toDataUrl(base64),
    pairingCode: readString(raw.pairingCode) ?? (qrcode ? readString(qrcode.pairingCode) : null),
    code: readString(raw.code) ?? (qrcode ? readString(qrcode.code) : null),
  };
}

function toDataUrl(base64: string | null): string | null {
  if (!base64) {
    return null;
  }
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
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
