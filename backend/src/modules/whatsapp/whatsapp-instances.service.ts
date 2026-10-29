import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WhatsAppHistorySyncStatus, WhatsAppInstanceStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { EvolutionClient, EvolutionRequestError } from './evolution/evolution.client.js';
import { WhatsAppContactSyncService } from './whatsapp-contact-sync.service.js';
import type {
  CreateWhatsAppInstanceDto,
  ListWhatsAppInstancesQueryDto,
  UpdateWhatsAppInstanceDto,
  WhatsAppCredentialsDto,
} from './dto/whatsapp-instance.dto.js';
import {
  WhatsAppConnectionInProgressError,
  WhatsAppInstanceLimitReachedError,
  WhatsAppInstanceNameConflictError,
  WhatsAppInstanceNotFoundError,
} from './whatsapp.errors.js';

export interface WhatsAppHistorySyncView {
  status: WhatsAppHistorySyncStatus;
  progress: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export interface WhatsAppInstanceView {
  id: string;
  name: string;
  instanceName: string;
  externalInstanceId: string | null;
  phone: string | null;
  status: WhatsAppInstanceStatus;
  statusReason: number | null;
  connectionObservedAt: Date | null;
  active: boolean;
  hasCredentials: boolean;
  historySync: WhatsAppHistorySyncView;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppliedHistorySyncState extends WhatsAppHistorySyncView {
  instanceId: string;
  tenantId: string;
  changed: boolean;
}

export interface HistorySyncUpdate {
  progress?: number | null;
  completed?: boolean;
  failed?: boolean;
  error?: string | null;
  onlyIfSyncing?: boolean;
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
  updatedAt?: string;
}

export interface ConnectionObservationOptions {
  observedAt?: Date;
  reason?: number | null;
  source?: ConnectionObservationSource;
  attemptId?: string;
}

export type ConnectionObservationSource =
  'webhook' | 'poll' | 'reconcile' | 'connect' | 'disconnect';

export interface AppliedConnectionObservation {
  instanceId: string;
  tenantId: string;
  instanceName: string;
  previousStatus: WhatsAppInstanceStatus;
  status: WhatsAppInstanceStatus;
  changed: boolean;
  observedAt: Date;
  reason: number | null;
  source: ConnectionObservationSource;
}

export interface WhatsAppConnectionQr {
  qrCodeBase64: string | null;
  pairingCode: string | null;
  code: string | null;
  updatedAt: Date;
}

export interface ProviderQrParts {
  qrCodeBase64: string;
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
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'CHATS_SET',
  'CHATS_UPSERT',
  'CHATS_UPDATE',
  'GROUPS_UPSERT',
  'GROUP_UPDATE',
  'GROUP_PARTICIPANTS_UPDATE',
  'PRESENCE_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
  'STATUS_INSTANCE',
  'LOGOUT_INSTANCE',
];

const EVOLUTION_INSTANCE_POLL_INTERVAL_MS = 250;
const EVOLUTION_INSTANCE_POLL_TIMEOUT_MS = 10_000;
const DISCONNECT_CONFIRM_DELAY_MS = 500;
const CONNECT_TICKET_RETRY_DELAY_MS = 1_500;
const CONNECT_TICKET_ATTEMPTS = 2;
const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const TERMINAL_DISCONNECT_REASONS = new Set([401, 403]);

@Injectable()
export class WhatsAppInstancesService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppInstancesService.name);
  private readonly connectionOperations = new Map<string, string>();
  private readonly qrCache = new Map<string, WhatsAppConnectionQr>();
  private reconcileRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly encryption: EncryptionService,
    private readonly evolution: EvolutionClient,
    private readonly contactSync: WhatsAppContactSyncService,
    private readonly realtime: RealtimeService,
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
        where: { active: true },
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

  async findResolved(id: string): Promise<ResolvedInstance> {
    const { tenantId } = this.tenantContext.requireContext();
    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { id, tenantId },
      select: { id: true, tenantId: true, instanceName: true, status: true },
    });

    if (!instance) {
      throw new WhatsAppInstanceNotFoundError();
    }

    return instance;
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

    this.clearConnectionQr(instance.id);
  }

  async connect(id: string): Promise<WhatsAppConnectionTicket> {
    return this.runConnectionOperation(id, 'connect', async () => {
      const instance = await this.requireInstanceById(id);
      const attemptId = randomUUID();
      const observedAt = new Date();
      this.logConnection('requested', {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        instanceName: instance.instanceName,
        operation: 'connect',
        previousStatus: instance.status,
        attemptId,
        observedAt: observedAt.toISOString(),
      });

      let attempt: ConnectionAttempt;
      try {
        attempt = await this.ensureInstanceAndConnect(instance.instanceName);
      } catch (error) {
        this.logConnection('failed', {
          instanceId: instance.id,
          tenantId: instance.tenantId,
          instanceName: instance.instanceName,
          operation: 'connect',
          attemptId,
          error: error instanceof Error ? error.message : 'unknown',
        });
        throw error;
      }

      if (attempt.state === 'open') {
        await this.recordConnectionIntent(instance.id, WhatsAppInstanceStatus.CONNECTED, {
          observedAt,
          attemptId,
        });
        this.clearConnectionQr(instance.id);
        if (instance.status !== WhatsAppInstanceStatus.CONNECTED) {
          await this.syncContactsOnConnect(instance);
        }
        await this.tryConfigureWebhook(instance);

        return {
          status: WhatsAppInstanceStatus.CONNECTED,
          qrCodeBase64: null,
          pairingCode: null,
          code: null,
        };
      }

      const ticket = extractConnectionTicket(attempt.raw);

      if (!ticket.qrCodeBase64 && !ticket.pairingCode && !ticket.code) {
        this.logConnection('failed', {
          instanceId: instance.id,
          tenantId: instance.tenantId,
          instanceName: instance.instanceName,
          operation: 'connect',
          attemptId,
          error: 'missing_connection_ticket',
        });
        throw new EvolutionRequestError('Evolution API did not return a connection ticket');
      }

      await this.recordConnectionIntent(instance.id, WhatsAppInstanceStatus.CONNECTING, {
        observedAt,
        attemptId,
      });
      const qrUpdatedAt = new Date();
      this.cacheConnectionQr(instance, ticket, qrUpdatedAt);

      await this.tryConfigureWebhook(instance);

      this.logConnection('ticket_issued', {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        instanceName: instance.instanceName,
        operation: 'connect',
        previousStatus: instance.status,
        nextStatus: WhatsAppInstanceStatus.CONNECTING,
        attemptId,
        observedAt: qrUpdatedAt.toISOString(),
      });

      return {
        status: WhatsAppInstanceStatus.CONNECTING,
        ...ticket,
        updatedAt: qrUpdatedAt.toISOString(),
      };
    });
  }

  async configureWebhook(id: string): Promise<WhatsAppWebhookResult> {
    const instance = await this.requireInstanceById(id);
    return this.configureWebhookForInstance(instance);
  }

  async disconnect(id: string): Promise<{ status: WhatsAppInstanceStatus }> {
    return this.runConnectionOperation(id, 'disconnect', async () => {
      const instance = await this.requireInstanceById(id);
      const attemptId = randomUUID();
      this.logConnection('requested', {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        instanceName: instance.instanceName,
        operation: 'disconnect',
        previousStatus: instance.status,
        attemptId,
        observedAt: new Date().toISOString(),
      });
      let logoutError: unknown = null;
      try {
        await this.evolution.disconnect(instance.instanceName);
      } catch (error) {
        // The logout request may fail after the provider has already dropped the
        // session (timeout, broken socket). The authoritative state query below
        // decides whether the disconnection actually happened.
        logoutError = error;
      }

      if (!(await this.waitForProviderDisconnect(instance.instanceName))) {
        this.logConnection('failed', {
          instanceId: instance.id,
          tenantId: instance.tenantId,
          instanceName: instance.instanceName,
          operation: 'disconnect',
          attemptId,
          error: 'provider_did_not_confirm_disconnect',
        });
        throw logoutError instanceof Error
          ? logoutError
          : new EvolutionRequestError('Evolution API did not confirm the disconnect');
      }

      const result = await this.applyConnectionObservation(instance.instanceName, 'close', {
        observedAt: new Date(),
        source: 'disconnect',
        reason: null,
        attemptId,
      });

      return { status: result?.status ?? WhatsAppInstanceStatus.DISCONNECTED };
    });
  }

  async refreshStatus(id: string): Promise<{
    status: WhatsAppInstanceStatus;
    reason: number | null;
  }> {
    const instance = await this.requireInstanceById(id);
    const observedAt = new Date();
    const state = await this.evolution.getConnectionState(instance.instanceName);
    const result = await this.applyConnectionObservation(instance.instanceName, state.state, {
      observedAt,
      source: 'poll',
    });

    if (result) {
      return { status: result.status, reason: result.reason };
    }

    const current = await this.prisma.whatsAppInstance.findUnique({
      where: { id: instance.id },
      select: { status: true, connectionStatusReason: true },
    });
    return {
      status: current?.status ?? instance.status,
      reason: current?.connectionStatusReason ?? null,
    };
  }

  /**
   * Single entry point for provider connection observations, shared by webhooks,
   * polling and the periodic reconciliation. Observations are applied only when
   * they are newer than the last applied one, so delayed events cannot override
   * a more recent state. `open` is not a guarantee that sends succeed, but
   * `close`/`connecting`/error is authoritative evidence that the session is
   * degraded.
   */
  async applyConnectionObservation(
    instanceName: string,
    state: string | null,
    options: ConnectionObservationOptions = {},
  ): Promise<AppliedConnectionObservation | null> {
    const status = mapEvolutionState(state);
    if (status === null) {
      return null;
    }

    const observedAt = options.observedAt ?? new Date();
    const source = options.source ?? 'webhook';
    const reason = options.reason ?? null;

    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { instanceName },
      select: {
        id: true,
        tenantId: true,
        instanceName: true,
        status: true,
        connectionObservedAt: true,
        connectionRequestedAt: true,
      },
    });
    if (!instance) {
      return null;
    }

    if (
      instance.connectionObservedAt &&
      observedAt.getTime() < instance.connectionObservedAt.getTime()
    ) {
      this.logConnection('ignored_stale', {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        instanceName,
        operation: source,
        previousStatus: instance.status,
        providerStatus: status,
        observedAt: observedAt.toISOString(),
        lastObservedAt: instance.connectionObservedAt.toISOString(),
        reason,
      });
      return this.observationResult(instance, instance.status, observedAt, reason, source, false);
    }

    // A deliberately disconnected instance does not come back from a delayed
    // asynchronous event. Only an explicit new connection request (which sets
    // connectionRequestedAt and CONNECTING) re-arms the instance. A live
    // snapshot (`open` from connectionState) is authoritative, because the
    // provider has already dropped the session by the time a disconnect is
    // confirmed.
    const liveSnapshot = source === 'poll' || source === 'reconcile';
    if (
      instance.status === WhatsAppInstanceStatus.DISCONNECTED &&
      status !== WhatsAppInstanceStatus.DISCONNECTED &&
      !instance.connectionRequestedAt &&
      !liveSnapshot
    ) {
      this.logConnection('ignored_after_disconnect', {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        instanceName,
        operation: source,
        previousStatus: instance.status,
        providerStatus: status,
        observedAt: observedAt.toISOString(),
        reason,
      });
      return this.observationResult(instance, instance.status, observedAt, reason, source, false);
    }

    // Evolution reports `close` while the socket is still starting after an
    // explicit connect. Never downgrade a fresh attempt because of a transient
    // close; a terminal reason (401/403) or the grace window still applies.
    if (
      instance.status === WhatsAppInstanceStatus.CONNECTING &&
      status === WhatsAppInstanceStatus.DISCONNECTED &&
      source !== 'disconnect' &&
      !TERMINAL_DISCONNECT_REASONS.has(reason ?? 0) &&
      instance.connectionRequestedAt &&
      Date.now() - instance.connectionRequestedAt.getTime() <
        this.config.get('WHATSAPP_CONNECT_FLOW_GRACE_MS')
    ) {
      this.logConnection('ignored_connect_grace', {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        instanceName,
        operation: source,
        previousStatus: instance.status,
        providerStatus: status,
        observedAt: observedAt.toISOString(),
        reason,
      });
      return this.observationResult(instance, instance.status, observedAt, reason, source, false);
    }

    const data: Prisma.WhatsAppInstanceUpdateManyMutationInput = {
      status,
      connectionObservedAt: observedAt,
      connectionStatusReason: reason,
    };
    if (status === WhatsAppInstanceStatus.DISCONNECTED) {
      data.connectionRequestedAt = null;
    }

    const applied = await this.prisma.whatsAppInstance.updateMany({
      where: {
        id: instance.id,
        OR: [{ connectionObservedAt: null }, { connectionObservedAt: { lte: observedAt } }],
      },
      data,
    });

    if (applied.count === 0) {
      this.logConnection('lost_race', {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        instanceName,
        operation: source,
        previousStatus: instance.status,
        providerStatus: status,
        observedAt: observedAt.toISOString(),
        reason,
      });
      const current = await this.prisma.whatsAppInstance.findUnique({
        where: { id: instance.id },
        select: { status: true },
      });
      return this.observationResult(
        instance,
        current?.status ?? instance.status,
        observedAt,
        reason,
        source,
        false,
      );
    }

    const changed = instance.status !== status;
    if (status !== WhatsAppInstanceStatus.CONNECTING) {
      this.clearConnectionQr(instance.id);
    }

    if (changed) {
      this.logConnection('applied', {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        instanceName,
        operation: source,
        previousStatus: instance.status,
        providerStatus: status,
        observedAt: observedAt.toISOString(),
        reason,
        attemptId: options.attemptId ?? null,
      });
    }

    if (status !== WhatsAppInstanceStatus.CONNECTED) {
      await this.interruptHistorySync(instance.instanceName, source);
    }

    if (changed) {
      this.realtime.emitToTenant(instance.tenantId, 'whatsapp.instance.updated', {
        instanceId: instance.id,
        status,
        previousStatus: instance.status,
        reason,
      });

      if (status === WhatsAppInstanceStatus.CONNECTED) {
        await this.syncContactsOnConnect(instance);
      }
    }

    return this.observationResult(instance, status, observedAt, reason, source, changed);
  }

  /**
   * Stores the latest QR in memory (never in the database or logs) and pushes it
   * only to the tenant administrators, who are the users allowed to connect.
   */
  async applyProviderQr(
    instance: { id: string; tenantId: string; instanceName: string },
    payloadData: unknown,
    observedAt: Date,
  ): Promise<void> {
    const ticket = extractProviderQr(payloadData);
    if (!ticket) {
      return;
    }
    this.cacheConnectionQr(instance, ticket, observedAt);
  }

  getConnectionQr(instanceId: string): WhatsAppConnectionQr | null {
    const cached = this.qrCache.get(instanceId);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.updatedAt.getTime() > this.config.get('WHATSAPP_QR_CACHE_TTL_MS')) {
      this.qrCache.delete(instanceId);
      return null;
    }
    return cached;
  }

  /**
   * Periodic reconciliation used by the background job. A webhook may never
   * arrive (Evolution reconnects silently) or may be lost while the backend is
   * down, so the provider state is re-read for active instances.
   */
  async reconcileConnectionStates(): Promise<void> {
    if (!this.evolution.configured || this.reconcileRunning) {
      return;
    }
    this.reconcileRunning = true;

    try {
      await this.runConnectionReconciliation();
    } finally {
      this.reconcileRunning = false;
    }
  }

  private async runConnectionReconciliation(): Promise<void> {
    let instances: Array<{ id: string; tenantId: string; instanceName: string }>;
    try {
      instances = await this.prisma.whatsAppInstance.findMany({
        where: {
          active: true,
          status: {
            in: [
              WhatsAppInstanceStatus.CONNECTED,
              WhatsAppInstanceStatus.CONNECTING,
              WhatsAppInstanceStatus.ERROR,
            ],
          },
        },
        select: { id: true, tenantId: true, instanceName: true },
      });
    } catch (error) {
      this.logger.warn(
        `Connection reconciliation scan failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return;
    }

    let changed = 0;
    let failed = 0;

    for (const instance of instances) {
      await this.runAsTenant(instance.tenantId, async () => {
        const observedAt = new Date();
        try {
          const state = await this.evolution.getConnectionState(instance.instanceName);

          if (state.state.toLowerCase() === 'unknown') {
            if (await this.evolution.instanceExists(instance.instanceName)) {
              return;
            }
            const result = await this.applyConnectionObservation(instance.instanceName, 'close', {
              observedAt,
              source: 'reconcile',
              reason: null,
            });
            if (result?.changed) {
              changed += 1;
            }
            return;
          }

          const result = await this.applyConnectionObservation(instance.instanceName, state.state, {
            observedAt,
            source: 'reconcile',
          });
          if (result?.changed) {
            changed += 1;
          }
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `Connection reconciliation failed for instance ${instance.id}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      });
    }

    this.logConnection('reconciled', {
      scanned: instances.length,
      changed,
      failed,
    });
  }

  /**
   * Persists the synchronization state advertised by the provider. `progress`
   * is only stored when the provider actually sent it (0..100); it is never
   * derived from `isLatest`, whose semantics do not mean completion.
   */
  async applyHistorySyncUpdate(
    instanceName: string,
    update: HistorySyncUpdate,
  ): Promise<AppliedHistorySyncState | null> {
    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { instanceName },
      select: {
        id: true,
        tenantId: true,
        historySyncStatus: true,
        historySyncProgress: true,
        historySyncStartedAt: true,
        historySyncCompletedAt: true,
        historySyncError: true,
      },
    });
    if (!instance) {
      return null;
    }

    const current: AppliedHistorySyncState = {
      instanceId: instance.id,
      tenantId: instance.tenantId,
      status: instance.historySyncStatus,
      progress: instance.historySyncProgress,
      startedAt: instance.historySyncStartedAt,
      completedAt: instance.historySyncCompletedAt,
      error: instance.historySyncError,
      changed: false,
    };

    if (update.onlyIfSyncing && current.status !== WhatsAppHistorySyncStatus.SYNCING) {
      return current;
    }

    const now = new Date();
    const observed = normalizeHistoryProgress(update.progress);
    let status = current.status;
    let progress = current.progress;
    let startedAt = current.startedAt;
    let completedAt = current.completedAt;
    let error = current.error;

    if (update.completed) {
      status = WhatsAppHistorySyncStatus.COMPLETED;
      progress = 100;
      startedAt ??= now;
      completedAt = current.completedAt ?? now;
      error = null;
    } else if (update.failed) {
      if (current.status === WhatsAppHistorySyncStatus.COMPLETED && observed === null) {
        return current;
      }
      status = WhatsAppHistorySyncStatus.FAILED;
      if (observed !== null && (progress === null || observed >= progress)) {
        progress = observed;
      }
      startedAt ??= now;
      completedAt = null;
      error = update.error ?? 'history_import_failed';
    } else if (current.status === WhatsAppHistorySyncStatus.COMPLETED) {
      // A lower progress after completion means WhatsApp started a new history
      // sync (for example after a reconnect). Replaying the same completed
      // batch again (progress 100 or absent) must not reopen the cycle.
      if (observed !== null && observed < 100) {
        status = WhatsAppHistorySyncStatus.SYNCING;
        progress = observed;
        startedAt = now;
        completedAt = null;
        error = null;
      }
    } else {
      status = WhatsAppHistorySyncStatus.SYNCING;
      if (observed !== null && (progress === null || observed >= progress)) {
        progress = observed;
      }
      startedAt ??= now;
      completedAt = null;
      error = null;
    }

    const changed =
      status !== current.status ||
      progress !== current.progress ||
      !sameDate(startedAt, current.startedAt) ||
      !sameDate(completedAt, current.completedAt) ||
      error !== current.error;

    if (changed) {
      await this.prisma.whatsAppInstance.update({
        where: { id: instance.id },
        data: {
          historySyncStatus: status,
          historySyncProgress: progress,
          historySyncStartedAt: startedAt,
          historySyncCompletedAt: completedAt,
          historySyncError: error,
        },
      });
    }

    return {
      instanceId: instance.id,
      tenantId: instance.tenantId,
      status,
      progress,
      startedAt,
      completedAt,
      error,
      changed,
    };
  }

  async markHistorySyncInterrupted(
    instanceName: string,
    reason: string,
  ): Promise<AppliedHistorySyncState | null> {
    return this.applyHistorySyncUpdate(instanceName, {
      failed: true,
      error: reason,
      onlyIfSyncing: true,
    });
  }

  private runConnectionOperation<T>(
    instanceId: string,
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (this.connectionOperations.has(instanceId)) {
      throw new WhatsAppConnectionInProgressError();
    }

    this.connectionOperations.set(instanceId, operation);
    return fn().finally(() => {
      this.connectionOperations.delete(instanceId);
    });
  }

  private async recordConnectionIntent(
    id: string,
    status: WhatsAppInstanceStatus,
    options: { observedAt: Date; attemptId: string },
  ): Promise<void> {
    const now = options.observedAt;
    // Conditional write: a webhook observed after the request started must win
    // over the intent, so a late status cannot be downgraded by the request.
    await this.prisma.whatsAppInstance.updateMany({
      where: {
        id,
        OR: [{ connectionObservedAt: null }, { connectionObservedAt: { lte: now } }],
      },
      data: {
        status,
        connectionObservedAt: now,
        connectionStatusReason: null,
        connectionRequestedAt: now,
      },
    });
  }

  private observationResult(
    instance: {
      id: string;
      tenantId: string;
      instanceName: string;
      status: WhatsAppInstanceStatus;
    },
    status: WhatsAppInstanceStatus,
    observedAt: Date,
    reason: number | null,
    source: ConnectionObservationSource,
    changed: boolean,
  ): AppliedConnectionObservation {
    return {
      instanceId: instance.id,
      tenantId: instance.tenantId,
      instanceName: instance.instanceName,
      previousStatus: instance.status,
      status,
      changed,
      observedAt,
      reason,
      source,
    };
  }

  private async interruptHistorySync(instanceName: string, reason: string): Promise<void> {
    const history = await this.markHistorySyncInterrupted(instanceName, reason);
    if (history?.changed) {
      this.realtime.emitToTenant(history.tenantId, 'whatsapp.history.updated', {
        instanceId: history.instanceId,
        status: history.status,
        progress: history.progress,
        startedAt: history.startedAt,
        completedAt: history.completedAt,
        error: history.error,
      });
    }
  }

  private async syncContactsOnConnect(instance: {
    tenantId: string;
    instanceName: string;
  }): Promise<void> {
    await this.contactSync.enqueue({
      tenantId: instance.tenantId,
      instanceName: instance.instanceName,
    });
  }

  private cacheConnectionQr(
    instance: { id: string; tenantId: string; instanceName: string },
    ticket: ConnectionTicketParts,
    observedAt: Date,
  ): void {
    const current = this.qrCache.get(instance.id);
    if (current && observedAt.getTime() < current.updatedAt.getTime()) {
      return;
    }

    const cached: WhatsAppConnectionQr = {
      qrCodeBase64: ticket.qrCodeBase64,
      pairingCode: ticket.pairingCode,
      code: ticket.code,
      updatedAt: observedAt,
    };
    this.qrCache.set(instance.id, cached);
    this.pruneConnectionQrCache();

    this.realtime.emitToTenantAdmins(instance.tenantId, 'whatsapp.instance.qr', {
      instanceId: instance.id,
      qrCodeBase64: cached.qrCodeBase64,
      pairingCode: cached.pairingCode,
      code: cached.code,
      updatedAt: cached.updatedAt,
    });
  }

  private clearConnectionQr(instanceId: string): void {
    this.qrCache.delete(instanceId);
  }

  private pruneConnectionQrCache(): void {
    const ttl = this.config.get('WHATSAPP_QR_CACHE_TTL_MS');
    const now = Date.now();
    for (const [instanceId, cached] of this.qrCache) {
      if (now - cached.updatedAt.getTime() > ttl) {
        this.qrCache.delete(instanceId);
      }
    }
  }

  private logConnection(event: string, payload: Record<string, unknown>): void {
    this.logger.log(`whatsapp.connection.${event} ${JSON.stringify(payload)}`);
  }

  private runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const context: TenantContext = {
      tenantId,
      userId: SYSTEM_USER_ID,
      membershipId: SYSTEM_MEMBERSHIP_ID,
      role: 'SYSTEM',
    };
    return this.tenantContext.run({ tenant: context }, fn);
  }

  private async ensureInstanceAndConnect(instanceName: string): Promise<ConnectionAttempt> {
    if (!(await this.evolution.instanceExists(instanceName))) {
      try {
        // The create response already carries the QR code for a fresh instance.
        return { raw: await this.evolution.createInstance(instanceName), state: 'close' };
      } catch (error) {
        if (!isEvolutionAlreadyExists(error)) {
          throw error;
        }

        // A concurrent request created it between the existence check and the
        // create call. Reuse the fresh instance instead of deleting it.
      }
    }

    const providerState = await this.evolution.getConnectionState(instanceName);
    const state = providerState.state.toLowerCase();

    if (state === 'open') {
      return { raw: null, state };
    }

    const raw = await this.connectUntilTicket(instanceName);
    if (raw !== null) {
      return { raw, state };
    }

    if (!this.config.get('WHATSAPP_AUTO_RECREATE_STALE_SESSION')) {
      this.logger.warn(
        `Evolution did not return a connection ticket for ${instanceName}; automatic recreation is disabled`,
      );
      throw new EvolutionRequestError(
        'Evolution API did not return a connection ticket; generate a new QR code or check the instance',
      );
    }

    // Last resort, only when explicitly enabled: the in-memory session is
    // broken and the provider keeps answering without a usable ticket.
    this.logger.warn(`Recreating stale Evolution instance ${instanceName}`);
    return { raw: await this.recreateEvolutionInstance(instanceName), state: 'close' };
  }

  private async connectUntilTicket(instanceName: string): Promise<unknown | null> {
    for (let attempt = 0; attempt < CONNECT_TICKET_ATTEMPTS; attempt += 1) {
      try {
        const raw = await this.evolution.connect(instanceName);
        if (hasConnectionTicket(extractConnectionTicket(raw))) {
          return raw;
        }
      } catch (error) {
        if (!isEvolutionMissing(error)) {
          throw error;
        }
        return null;
      }

      if (attempt < CONNECT_TICKET_ATTEMPTS - 1) {
        await delay(CONNECT_TICKET_RETRY_DELAY_MS);
      }
    }
    return null;
  }

  private async recreateEvolutionInstance(instanceName: string): Promise<unknown> {
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

  private async waitForEvolutionInstance(instanceName: string, expected: boolean): Promise<void> {
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

  private async waitForProviderDisconnect(instanceName: string): Promise<boolean> {
    const deadline = Date.now() + this.config.get('WHATSAPP_DISCONNECT_CONFIRM_TIMEOUT_MS');
    let lastError: unknown = null;

    while (Date.now() < deadline) {
      try {
        const providerState = await this.evolution.getConnectionState(instanceName);
        if (await this.isProviderDisconnected(instanceName, providerState.state)) {
          return true;
        }
      } catch (error) {
        lastError = error;
      }

      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await delay(Math.min(DISCONNECT_CONFIRM_DELAY_MS, remaining));
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    return false;
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

    await this.evolution.setWebhook(instance.instanceName, webhookUrl, this.webhookEvents());

    // Never return the secret embedded in the URL.
    return { webhookConfigured: true, webhookUrl: baseUrl };
  }

  private webhookEvents(): string[] {
    return this.config.get('WHATSAPP_HISTORY_IMPORT_ENABLED')
      ? ['MESSAGES_SET', 'MESSAGING_HISTORY_SET', ...WEBHOOK_EVENTS]
      : WEBHOOK_EVENTS;
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
    if (
      !credentials ||
      (credentials.apiKey === undefined && credentials.webhookSecret === undefined)
    ) {
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
  connectionStatusReason?: number | null;
  connectionObservedAt?: Date | null;
  active: boolean;
  credentialsEncrypted: string | null;
  historySyncStatus?: WhatsAppHistorySyncStatus;
  historySyncProgress?: number | null;
  historySyncStartedAt?: Date | null;
  historySyncCompletedAt?: Date | null;
  historySyncError?: string | null;
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
    statusReason: instance.connectionStatusReason ?? null,
    connectionObservedAt: instance.connectionObservedAt ?? null,
    active: instance.active,
    hasCredentials: Boolean(instance.credentialsEncrypted),
    historySync: {
      status: instance.historySyncStatus ?? WhatsAppHistorySyncStatus.IDLE,
      progress: instance.historySyncProgress ?? null,
      startedAt: instance.historySyncStartedAt ?? null,
      completedAt: instance.historySyncCompletedAt ?? null,
      error: instance.historySyncError ?? null,
    },
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

export function mapEvolutionState(state: string | null): WhatsAppInstanceStatus | null {
  if (typeof state !== 'string' || state.length === 0) {
    return null;
  }
  switch (state.toLowerCase()) {
    case 'open':
    case 'connected':
      return WhatsAppInstanceStatus.CONNECTED;
    case 'connecting':
      return WhatsAppInstanceStatus.CONNECTING;
    case 'close':
    case 'disconnected':
      return WhatsAppInstanceStatus.DISCONNECTED;
    case 'refused':
    case 'error':
      return WhatsAppInstanceStatus.ERROR;
    default:
      return null;
  }
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

function isEvolutionMissing(error: unknown): boolean {
  return (
    error instanceof EvolutionRequestError && (error.httpStatus === 400 || error.httpStatus === 404)
  );
}

function hasConnectionTicket(ticket: ConnectionTicketParts): boolean {
  return Boolean(ticket.qrCodeBase64 || ticket.pairingCode || ticket.code);
}

function mapNameConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new WhatsAppInstanceNameConflictError();
  }
  return error;
}

interface ConnectionAttempt {
  raw: unknown;
  state: string;
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

/**
 * Evolution emits the rotated QR as `{ qrcode: { base64, code, pairingCode } }`
 * in `qrcode.updated`. Some builds flatten it into the data object.
 */
function extractProviderQr(payloadData: unknown): ProviderQrParts | null {
  if (!isRecord(payloadData)) {
    return null;
  }

  const qrcode = isRecord(payloadData.qrcode) ? payloadData.qrcode : null;
  const base64 = readString(payloadData.base64) ?? (qrcode ? readString(qrcode.base64) : null);
  if (!base64) {
    return null;
  }

  return {
    qrCodeBase64: toDataUrl(base64) as string,
    pairingCode:
      readString(payloadData.pairingCode) ?? (qrcode ? readString(qrcode.pairingCode) : null),
    code: readString(payloadData.code) ?? (qrcode ? readString(qrcode.code) : null),
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

function normalizeHistoryProgress(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0 || value > 100) {
    return null;
  }
  return Math.round(value);
}

function sameDate(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.getTime() === right.getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
