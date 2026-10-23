import { setTimeout as delay } from 'node:timers/promises';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WhatsAppInstanceStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EvolutionClient, EvolutionRequestError } from './evolution/evolution.client.js';
import { WhatsAppContactSyncService } from './whatsapp-contact-sync.service.js';
import type {
  CreateWhatsAppInstanceDto,
  ListWhatsAppInstancesQueryDto,
  UpdateWhatsAppInstanceDto,
  WhatsAppCredentialsDto,
} from './dto/whatsapp-instance.dto.js';
import {
  WhatsAppInstanceLimitReachedError,
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

export interface WhatsAppQuotaView {
  used: number;
  canCreate: boolean;
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

const WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_EDITED',
  'GROUPS_UPSERT',
  'PRESENCE_UPDATE',
  'CONNECTION_UPDATE',
];

const EVOLUTION_INSTANCE_POLL_INTERVAL_MS = 250;
const EVOLUTION_INSTANCE_POLL_TIMEOUT_MS = 10_000;

@Injectable()
export class WhatsAppInstancesService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppInstancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly encryption: EncryptionService,
    private readonly evolution: EvolutionClient,
    private readonly contactSync: WhatsAppContactSyncService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }
    void this.reconcileWebhooks();
    void this.reconcileContacts();
  }

  /**
   * Imports the address book of every already connected instance at boot, so
   * numbers connected before this feature existed get their contacts pulled
   * automatically without any manual action.
   */
  private async reconcileContacts(): Promise<void> {
    if (!this.evolution.configured) {
      return;
    }

    try {
      const instances = await this.prisma.whatsAppInstance.findMany({
        where: { active: true, status: WhatsAppInstanceStatus.CONNECTED },
        select: { tenantId: true, instanceName: true },
      });

      for (const instance of instances) {
        await this.contactSync.enqueue(instance);
      }
    } catch (error) {
      this.logger.warn(
        `Contact reconciliation failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Re-applies the webhook to every connected instance at boot so a changed
   * PUBLIC_API_URL (host, port or domain) self-heals without manual reconfiguration.
   */
  private async reconcileWebhooks(): Promise<void> {
    if (!this.evolution.configured) {
      return;
    }
    if (!this.config.get('PUBLIC_API_URL')) {
      this.logger.warn('PUBLIC_API_URL is not set; skipping webhook reconciliation');
      return;
    }

    try {
      const instances = await this.prisma.whatsAppInstance.findMany({
        where: {
          active: true,
          status: { in: [WhatsAppInstanceStatus.CONNECTED, WhatsAppInstanceStatus.CONNECTING] },
        },
        select: { id: true, tenantId: true, instanceName: true, credentialsEncrypted: true },
      });

      if (instances.length === 0) {
        return;
      }

      this.logger.log(`Reconciling webhook for ${instances.length} instance(s)`);
      for (const instance of instances) {
        await this.tryConfigureWebhook(instance);
      }
    } catch (error) {
      this.logger.warn(
        `Webhook reconciliation failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

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

  async getQuota(): Promise<WhatsAppQuotaView> {
    const { tenantId } = this.tenantContext.requireContext();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { whatsappInstanceLimit: true },
    });

    if (!tenant) {
      throw new AppException('TENANT_NOT_FOUND', 'Tenant not found', 404);
    }

    const used = await this.prisma.whatsAppInstance.count({ where: { tenantId } });
    return {
      used,
      canCreate: used < tenant.whatsappInstanceLimit,
    };
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
      const instance = await this.prisma.$transaction(async (tx) => {
        // Serializes concurrent creations for the same tenant, so the count and
        // the insert cannot interleave and exceed the configured limit.
        const tenants = await tx.$queryRaw<Array<{ whatsappInstanceLimit: number }>>`
          SELECT "whatsapp_instance_limit" AS "whatsappInstanceLimit"
          FROM "tenants"
          WHERE "id" = ${tenantId}::uuid
          FOR UPDATE
        `;
        const tenant = tenants[0];
        if (!tenant) {
          throw new AppException('TENANT_NOT_FOUND', 'Tenant not found', 404);
        }

        const used = await tx.whatsAppInstance.count({ where: { tenantId } });
        if (used >= tenant.whatsappInstanceLimit) {
          throw new WhatsAppInstanceLimitReachedError(used);
        }

        return tx.whatsAppInstance.create({
          data: {
            tenantId,
            name: dto.name.trim(),
            instanceName: dto.instanceName.trim(),
            phone: normalizeNullableString(dto.phone),
            active: dto.active ?? true,
            credentialsEncrypted: this.encryptCredentials(dto.credentials),
          },
        });
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
    const instance = await this.requireInstanceById(id);

    if (this.evolution.configured) {
      try {
        await this.evolution.deleteInstance(instance.instanceName);
      } catch (error) {
        if (!isEvolutionNotFound(error)) {
          throw error;
        }
      }
    }

    const result = await this.prisma.whatsAppInstance.deleteMany({
      where: { id, tenantId: instance.tenantId },
    });

    if (result.count === 0) {
      throw new WhatsAppInstanceNotFoundError();
    }
  }

  async connect(id: string): Promise<WhatsAppConnectionTicket> {
    const instance = await this.requireInstanceById(id);

    const raw = await this.ensureInstanceAndConnect(instance.instanceName);
    const ticket = extractConnectionTicket(raw);

    if (!ticket.qrCodeBase64 && !ticket.pairingCode && !ticket.code) {
      throw new EvolutionRequestError('Evolution API did not return a connection ticket');
    }

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

    const providerState = await this.evolution.getConnectionState(instance.instanceName);
    if (!(await this.isProviderDisconnected(instance.instanceName, providerState.state))) {
      throw new EvolutionRequestError(
        `Evolution API did not confirm the disconnect (state: ${providerState.state})`,
      );
    }

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

    // A stale reconnect from a previous socket must not revive an instance the
    // operator explicitly disconnected. A new connection always starts at
    // CONNECTING, so an open provider state is still accepted as authoritative.
    if (
      instance.status === WhatsAppInstanceStatus.DISCONNECTED &&
      status === WhatsAppInstanceStatus.CONNECTING
    ) {
      return { status: instance.status };
    }

    const updated = await this.prisma.whatsAppInstance.update({
      where: { id },
      data: { status },
    });

    // First time the link turns CONNECTED, pull the WhatsApp address book.
    if (status === WhatsAppInstanceStatus.CONNECTED && instance.status !== status) {
      await this.contactSync.enqueue({
        tenantId: instance.tenantId,
        instanceName: instance.instanceName,
      });
    }

    return { status: updated.status };
  }

  /**
   * System variant used by the CONNECTION_UPDATE webhook. Persists the provider
   * state and reports whether it changed, so the caller can publish a realtime
   * event only when something actually changed. `open` is not a guarantee that
   * sends succeed, but `close`/`connecting`/error is authoritative evidence that
   * the session is degraded.
   */
  async applyProviderConnectionState(
    instanceName: string,
    state: string | null,
  ): Promise<{
    instanceId: string;
    tenantId: string;
    status: WhatsAppInstanceStatus;
    changed: boolean;
  } | null> {
    if (!state) {
      return null;
    }

    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { instanceName },
      select: { id: true, tenantId: true, status: true },
    });
    if (!instance) {
      return null;
    }

    const status = mapEvolutionState(state);

    // Evolution may emit `connecting` from a stale socket or a reconnect timer
    // after the operator disconnected. Only a new connection request (which
    // sets CONNECTING through the API) or an authoritative open/error state may
    // leave DISCONNECTED.
    if (
      instance.status === WhatsAppInstanceStatus.DISCONNECTED &&
      status === WhatsAppInstanceStatus.CONNECTING
    ) {
      return {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        status: instance.status,
        changed: false,
      };
    }

    if (instance.status !== status) {
      await this.prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { status } });
    }

    return {
      instanceId: instance.id,
      tenantId: instance.tenantId,
      status,
      changed: instance.status !== status,
    };
  }

  private async ensureInstanceAndConnect(instanceName: string): Promise<unknown> {
    if (!(await this.evolution.instanceExists(instanceName))) {
      try {
        // The create response already carries the QR code for a fresh instance.
        return await this.evolution.createInstance(instanceName);
      } catch (error) {
        if (!isEvolutionAlreadyExists(error)) {
          throw error;
        }

        // A concurrent request created it between the existence check and the
        // create call. Reuse the fresh instance instead of deleting it.
        return this.evolution.connect(instanceName);
      }
    }

    // Evolution 2.4.0-rc2 does not handle duplicate creates idempotently: it
    // replaces the in-memory instance with a new id and poisons the session.
    // Recreating from scratch is the only reliable way to obtain a fresh
    // connection ticket for an instance that already exists.
    await this.removeFromEvolution(instanceName);
    await this.waitForEvolutionInstance(instanceName, false);
    return this.evolution.createInstance(instanceName);
  }

  private async removeFromEvolution(instanceName: string): Promise<void> {
    try {
      await this.evolution.deleteInstance(instanceName);
    } catch (error) {
      if (!isEvolutionNotFound(error)) {
        throw error;
      }
    }
  }

  private async waitForEvolutionInstance(
    instanceName: string,
    expected: boolean,
  ): Promise<void> {
    const deadline = Date.now() + EVOLUTION_INSTANCE_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if ((await this.evolution.instanceExists(instanceName)) === expected) {
        return;
      }
      await delay(EVOLUTION_INSTANCE_POLL_INTERVAL_MS);
    }

    throw new EvolutionRequestError(
      `Evolution instance ${instanceName} was not ${expected ? 'created' : 'removed'} in time`,
    );
  }

  private async isProviderDisconnected(instanceName: string, state: string): Promise<boolean> {
    const normalized = state.toLowerCase();
    if (normalized === 'close' || normalized === 'disconnected') {
      return true;
    }

    // A missing provider instance has no session left to disconnect.
    return normalized === 'unknown' && !(await this.evolution.instanceExists(instanceName));
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
    const secret = this.resolveWebhookSecretOrNull(credentialsEncrypted);
    if (!secret) {
      throw new AppException(
        'WEBHOOK_SECRET_MISSING',
        'No webhook secret available (instance credentials or EVOLUTION_WEBHOOK_SECRET)',
        409,
      );
    }
    return secret;
  }

  private resolveWebhookSecretOrNull(credentialsEncrypted: string | null): string | null {
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

    return this.config.get('EVOLUTION_WEBHOOK_SECRET') ?? null;
  }

  /**
   * System lookup used by the public webhook to validate the request token before
   * a tenant context exists. Returns the instance-specific secret when set,
   * otherwise the global secret; null when the instance is unknown or inactive.
   */
  async resolveWebhookSecretForInstanceName(instanceName: string): Promise<string | null> {
    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { instanceName },
      select: { active: true, credentialsEncrypted: true },
    });

    if (!instance || !instance.active) {
      return null;
    }

    return this.resolveWebhookSecretOrNull(instance.credentialsEncrypted);
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

function isEvolutionAlreadyExists(error: unknown): boolean {
  return (
    error instanceof EvolutionRequestError &&
    (error.httpStatus === 409 || error.httpStatus === 400 || error.httpStatus === 403)
  );
}

function isEvolutionNotFound(error: unknown): boolean {
  return error instanceof EvolutionRequestError && error.httpStatus === 404;
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
