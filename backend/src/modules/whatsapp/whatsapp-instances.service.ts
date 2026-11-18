import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  WhatsAppConnectionIntent,
  WhatsAppHistorySyncStatus,
  WhatsAppInstanceStatus,
} from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import {
  EvolutionClient,
  EvolutionRequestError,
  type EvolutionInstanceSummary,
} from './evolution/evolution.client.js';
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
  WhatsAppProviderReconnectingError,
} from './whatsapp.errors.js';

export interface WhatsAppHistorySyncView {
  status: WhatsAppHistorySyncStatus;
  progress: number | null;
  chunks: number | null;
  messages: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date | null;
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
  chunks?: number | null;
  messages?: number | null;
  observedAt?: Date;
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
  /** Provider generation time when it is actually known (X-Timestamp); never used alone to order. */
  observedAt?: Date;
  /** Local receipt time, kept apart from the provider generation time. */
  receivedAt?: Date;
  reason?: number | null;
  source?: ConnectionObservationSource;
  attemptId?: string;
  intent?: WhatsAppConnectionIntent;
  eventType?: string;
  skipConfirmation?: boolean;
}

export type ConnectionObservationSource =
  'webhook' | 'poll' | 'reconcile' | 'connect' | 'disconnect' | 'send' | 'restore';

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
  version: number;
  ignored?: boolean;
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
const CONNECT_POLL_INTERVAL_MS = 1_000;
const CONNECT_RESTORE_WAIT_MS = 10_000;
const CONNECT_QR_GRACE_MS = 3_000;
const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const TERMINAL_DISCONNECT_REASONS = new Set([401, 403]);
const SESSION_REPLACED_REASON = 440;
// Logout, forbidden and the codes Evolution treats as final need a new pairing;
// 411/440 mean another device or session owns the number, so restoring would
// fight it.
const NON_RESTORABLE_REASONS = new Set([401, 402, 403, 406, 411, 440]);
const RESTORE_MAX_ATTEMPTS = 3;
const RESTORE_BACKOFF_BASE_MS = 60_000;
const RESTORE_POLL_INTERVAL_MS = 1_000;
// Evolution 2.4 does not reconnect these closes by itself (codesToNotReconnect):
// a negative reading after them is a real disconnection, never a flap.
const FINAL_CLOSE_REASONS = new Set([401, 402, 403, 406, 408]);
const CONFLICT_STORM_WINDOW_MS = 5 * 60_000;
const CONFLICT_STORM_THRESHOLD = 5;
const CONFLICT_STORM_LOG_INTERVAL_MS = 10 * 60_000;
const UNEXPECTED_RESTORE_SKIPS = new Set([
  'provider_unavailable',
  'provider_instance_missing',
  'provider_not_closed',
]);

interface ConnectionRow {
  id: string;
  tenantId: string;
  instanceName: string;
  status: WhatsAppInstanceStatus;
  connectionObservedAt: Date | null;
  connectionRequestedAt: Date | null;
  connectionStatusReason: number | null;
  connectionVersion: number;
  connectionStateVersion: number;
  connectionIntent: WhatsAppConnectionIntent;
}

type ProviderSnapshot =
  | { kind: 'confirmed'; status: WhatsAppInstanceStatus; raw: string }
  | { kind: 'unknown'; raw: string }
  | { kind: 'invalid' }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; error: unknown };

type NegativeConfirmation =
  | { kind: 'negative'; status: WhatsAppInstanceStatus; reads: number }
  | { kind: 'open' }
  | { kind: 'inconclusive' };

type RestoreTrigger = 'reconcile' | 'send';

interface RestoreCandidate {
  id: string;
  tenantId: string;
  instanceName: string;
  status: WhatsAppInstanceStatus;
  connectionIntent: WhatsAppConnectionIntent;
  connectionStatusReason: number | null;
  connectionObservedAt: Date | null;
}

/** What this process recently heard from the provider, per Evolution instance. */
interface ProviderSignals {
  lastActivityAt: number;
  lastOpenAt: number;
  conflictCloses: number[];
  stormLoggedAt: number;
}

interface RestoreState {
  /** First time this process saw the close confirmed; periodic reads refresh the DB timestamp. */
  closedSince: number;
  attempts: number;
  nextAttemptAt: number;
  exhausted: boolean;
}

@Injectable()
export class WhatsAppInstancesService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppInstancesService.name);
  private readonly connectionOperations = new Map<string, string>();
  private readonly historyOperations = new Map<string, Promise<void>>();
  private readonly qrCache = new Map<string, WhatsAppConnectionQr>();
  private readonly restoreStates = new Map<string, RestoreState>();
  private readonly providerSignals = new Map<string, ProviderSignals>();
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
      this.restoreStates.delete(instance.id);
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
        attempt = await this.ensureInstanceAndConnect(instance);
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
        await this.releaseDuplicateSessions(instance);
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
      this.restoreStates.delete(instance.id);
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
        receivedAt: new Date(),
        source: 'disconnect',
        reason: null,
        attemptId,
        intent: WhatsAppConnectionIntent.DISCONNECT,
      });

      return { status: result?.status ?? WhatsAppInstanceStatus.DISCONNECTED };
    });
  }

  async refreshStatus(id: string): Promise<{
    status: WhatsAppInstanceStatus;
    reason: number | null;
  }> {
    const instance = await this.requireInstanceById(id);
    const result = await this.verifyConnectionState(instance.instanceName, {
      source: 'poll',
      receivedAt: new Date(),
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
   * Entry point for every provider connection observation. Webhook, polling and
   * reconciliation are only signals: the current REST snapshot decides the
   * state. Explicit connect/disconnect intents are persisted directly because
   * the operation itself already confirmed the provider state.
   */
  async applyConnectionObservation(
    instanceName: string,
    state: string | null,
    options: ConnectionObservationOptions = {},
  ): Promise<AppliedConnectionObservation | null> {
    if ((options.source ?? 'webhook') === 'webhook') {
      this.recordProviderActivity(instanceName, state, options.reason ?? null, options.eventType);
    }
    const status = mapEvolutionState(state);
    if (status === null) {
      this.logConnection('snapshot.inconclusive', {
        instanceName,
        providerState: state,
        reason: 'unrecognized_state',
        source: options.source ?? 'webhook',
      });
      return null;
    }

    const source = options.source ?? 'webhook';
    if (source === 'connect' || source === 'disconnect') {
      const instance = await this.findConnectionRowByName(instanceName);
      if (!instance) {
        return null;
      }
      const current = await this.beginConnectionGeneration(instance.id);
      return this.applyConfirmedState(current, status, { ...options, source });
    }

    return this.verifyConnectionState(instanceName, { ...options, source, trigger: status });
  }

  /**
   * Send preflight. A confirmed `CONNECTED` never touches the provider. Any
   * other persisted state is re-read once: a live `open` repairs the CRM state
   * and lets the original send proceed; anything else blocks the send. The
   * session is never recreated here and the message is not replayed.
   */
  async ensureConnectedForSend(tenantId: string, instanceId: string): Promise<boolean> {
    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { id: instanceId, tenantId },
      select: {
        id: true,
        tenantId: true,
        instanceName: true,
        status: true,
        connectionObservedAt: true,
        connectionRequestedAt: true,
        connectionStatusReason: true,
        connectionVersion: true,
        connectionStateVersion: true,
        connectionIntent: true,
      },
    });
    if (!instance) {
      return false;
    }
    if (instance.status === WhatsAppInstanceStatus.CONNECTED) {
      return true;
    }

    const context = {
      instanceId: instance.id,
      tenantId: instance.tenantId,
      instanceName: instance.instanceName,
      previousStatus: instance.status,
      reason: instance.connectionStatusReason,
    };

    if (instance.connectionIntent === WhatsAppConnectionIntent.DISCONNECT) {
      this.logConnection('send.preflight', {
        ...context,
        result: 'blocked',
        reason: 'manual_disconnect_intent',
      });
      return false;
    }

    this.logConnection('send.preflight', {
      ...context,
      result: 'verifying',
      source: 'send',
    });

    const result = await this.verifyConnectionState(instance.instanceName, {
      source: 'send',
      receivedAt: new Date(),
      skipConfirmation: true,
    });
    let connected = result?.status === WhatsAppInstanceStatus.CONNECTED;

    if (!connected && instance.status === WhatsAppInstanceStatus.DISCONNECTED) {
      connected = await this.restoreAbandonedSession(instance, 'send', null);
    }

    this.logConnection('send.preflight', {
      ...context,
      result: connected ? 'recovered' : 'blocked',
      providerStatus: result?.status ?? 'unknown',
      version: result?.version ?? instance.connectionVersion,
    });

    return connected;
  }

  /**
   * Reads the provider and persists only evidence that survived the state
   * machine. Negative readings are confirmed by consecutive reads; failures,
   * invalid bodies, unknown states and missing instances preserve the last
   * confirmed state.
   */
  private async verifyConnectionState(
    instanceName: string,
    options: ConnectionObservationOptions & { trigger?: WhatsAppInstanceStatus },
  ): Promise<AppliedConnectionObservation | null> {
    const source = options.source ?? 'webhook';
    const receivedAt = options.receivedAt ?? new Date();
    const found = await this.findConnectionRowByName(instanceName);
    if (!found) {
      return null;
    }

    if (source === 'webhook') {
      this.logConnection('webhook.received', {
        instanceId: found.id,
        tenantId: found.tenantId,
        instanceName,
        eventType: options.eventType ?? null,
        providerStatus: options.trigger ?? null,
        eventTime: options.observedAt?.toISOString() ?? null,
        receivedAt: receivedAt.toISOString(),
        reason: options.reason ?? null,
      });
    }

    // A deliberate disconnect is only undone by an explicit connect (or by the
    // send preflight, which is an explicit user action).
    if (source !== 'send' && found.connectionIntent === WhatsAppConnectionIntent.DISCONNECT) {
      this.logConnection('observation.ignored_stale', {
        instanceId: found.id,
        tenantId: found.tenantId,
        instanceName,
        operation: source,
        previousStatus: found.status,
        providerStatus: options.trigger ?? null,
        reason: 'manual_disconnect_intent',
        version: found.connectionVersion,
      });
      return this.observationResult(
        found,
        found.status,
        receivedAt,
        found.connectionStatusReason,
        source,
        false,
        found.connectionVersion,
        true,
      );
    }

    const current = await this.beginConnectionGeneration(found.id);

    if (source !== 'send' && current.connectionIntent === WhatsAppConnectionIntent.DISCONNECT) {
      return this.observationResult(
        current,
        current.status,
        receivedAt,
        current.connectionStatusReason,
        source,
        false,
        current.connectionVersion,
        true,
      );
    }

    const snapshot = await this.readProviderSnapshot(instanceName);

    if (snapshot.kind !== 'confirmed') {
      if (snapshot.kind === 'unavailable' && source === 'poll') {
        throw snapshot.error;
      }
      this.logConnection('snapshot.inconclusive', {
        instanceId: current.id,
        tenantId: current.tenantId,
        instanceName,
        source,
        providerResult: snapshot.kind,
        providerState: snapshot.kind === 'unknown' ? snapshot.raw : null,
        error: snapshot.kind === 'unavailable' ? sanitizeConnectionError(snapshot.error) : null,
        previousStatus: current.status,
        version: current.connectionVersion,
      });
      return this.observationResult(
        current,
        current.status,
        receivedAt,
        current.connectionStatusReason,
        source,
        false,
        current.connectionVersion,
        true,
      );
    }

    this.logConnection('snapshot.confirmed', {
      instanceId: current.id,
      tenantId: current.tenantId,
      instanceName,
      source,
      previousStatus: current.status,
      providerStatus: snapshot.status,
      providerState: snapshot.raw,
      eventTime: options.observedAt?.toISOString() ?? null,
      receivedAt: receivedAt.toISOString(),
      version: current.connectionVersion,
    });

    if (snapshot.status === WhatsAppInstanceStatus.CONNECTED) {
      return this.applyConfirmedState(current, snapshot.status, {
        ...options,
        source,
        reason: null,
      });
    }

    // A session that is starting is not a disconnection. Keep the last
    // confirmed state instead of downgrading on a transient `connecting`.
    if (snapshot.status === WhatsAppInstanceStatus.CONNECTING) {
      this.logConnection('snapshot.inconclusive', {
        instanceId: current.id,
        tenantId: current.tenantId,
        instanceName,
        source,
        reason: 'connecting',
        previousStatus: current.status,
        version: current.connectionVersion,
      });
      return this.observationResult(
        current,
        current.status,
        receivedAt,
        current.connectionStatusReason,
        source,
        false,
        current.connectionVersion,
        true,
      );
    }

    const negativeStatus = snapshot.status;

    if (this.isWithinConnectGrace(current, negativeStatus, options.reason ?? null, source)) {
      this.logConnection('ignored_connect_grace', {
        instanceId: current.id,
        tenantId: current.tenantId,
        instanceName,
        operation: source,
        previousStatus: current.status,
        providerStatus: negativeStatus,
        reason: options.reason ?? null,
        version: current.connectionVersion,
      });
      return this.observationResult(
        current,
        current.status,
        receivedAt,
        current.connectionStatusReason,
        source,
        false,
        current.connectionVersion,
        true,
      );
    }

    // A session that was open seconds ago and reads closed now is flapping:
    // the provider is reconnecting it (or two sockets keep replacing each
    // other). Downgrading would block sends that the provider still delivers.
    if (this.isFlapping(instanceName, options.reason ?? null)) {
      this.logConnection('snapshot.inconclusive', {
        instanceId: current.id,
        tenantId: current.tenantId,
        instanceName,
        source,
        reason: 'recently_open',
        providerStatus: negativeStatus,
        lastOpenMsAgo: Date.now() - this.signalsFor(instanceName).lastOpenAt,
        previousStatus: current.status,
        version: current.connectionVersion,
      });
      return this.observationResult(
        current,
        current.status,
        receivedAt,
        current.connectionStatusReason,
        source,
        false,
        current.connectionVersion,
        true,
      );
    }

    if (options.skipConfirmation || source === 'send') {
      return this.observationResult(
        current,
        current.status,
        receivedAt,
        current.connectionStatusReason,
        source,
        false,
        current.connectionVersion,
        true,
      );
    }

    const confirmation = await this.confirmNegativeState(instanceName, negativeStatus, {
      instanceId: current.id,
      tenantId: current.tenantId,
      source,
      reason: options.reason ?? null,
    });

    if (confirmation.kind === 'open') {
      this.logConnection('recovered', {
        instanceId: current.id,
        tenantId: current.tenantId,
        instanceName,
        source,
        previousStatus: current.status,
        providerStatus: WhatsAppInstanceStatus.CONNECTED,
        version: current.connectionVersion,
      });
      return this.applyConfirmedState(current, WhatsAppInstanceStatus.CONNECTED, {
        ...options,
        source,
        reason: null,
      });
    }

    if (confirmation.kind === 'inconclusive') {
      return this.observationResult(
        current,
        current.status,
        receivedAt,
        current.connectionStatusReason,
        source,
        false,
        current.connectionVersion,
        true,
      );
    }

    this.logConnection('disconnect.confirmed', {
      instanceId: current.id,
      tenantId: current.tenantId,
      instanceName,
      source,
      previousStatus: current.status,
      providerStatus: confirmation.status,
      confirmations: confirmation.reads,
      reason: options.reason ?? null,
      version: current.connectionVersion,
    });

    return this.applyConfirmedState(current, confirmation.status, {
      ...options,
      source,
      reason: options.reason ?? null,
    });
  }

  /**
   * A negative reading is only persisted after N consecutive valid negative
   * snapshots. One `open` recovers immediately; any failure, invalid body,
   * unknown state or `connecting` stops the confirmation as inconclusive.
   */
  private async confirmNegativeState(
    instanceName: string,
    initial: WhatsAppInstanceStatus,
    context: {
      instanceId: string;
      tenantId: string;
      source: ConnectionObservationSource;
      reason: number | null;
    },
  ): Promise<NegativeConfirmation> {
    const reads = this.config.get('WHATSAPP_CONNECTION_CONFIRM_READS');
    const interval = this.config.get('WHATSAPP_CONNECTION_CONFIRM_INTERVAL_MS');
    let last = initial;

    this.logConnection('disconnect.pending', {
      instanceId: context.instanceId,
      tenantId: context.tenantId,
      source: context.source,
      providerStatus: initial,
      confirmations: 1,
      required: reads,
      reason: context.reason,
    });

    for (let index = 1; index < reads; index += 1) {
      if (interval > 0) {
        await delay(interval);
      }
      const snapshot = await this.readProviderSnapshot(instanceName);
      if (snapshot.kind !== 'confirmed') {
          this.logConnection('snapshot.inconclusive', {
          instanceId: context.instanceId,
          tenantId: context.tenantId,
          instanceName,
          source: context.source,
          providerResult: snapshot.kind,
          providerState: snapshot.kind === 'unknown' ? snapshot.raw : null,
          confirmations: index,
          required: reads,
        });
        return { kind: 'inconclusive' };
      }
      if (snapshot.status === WhatsAppInstanceStatus.CONNECTED) {
        return { kind: 'open' };
      }
      if (snapshot.status === WhatsAppInstanceStatus.CONNECTING) {
        return { kind: 'inconclusive' };
      }
      last = snapshot.status;
    }

    return { kind: 'negative', status: last, reads };
  }

  private async readProviderSnapshot(instanceName: string): Promise<ProviderSnapshot> {
    try {
      const snapshot = await this.evolution.getConnectionState(instanceName);
      const kind = snapshot.kind ?? (mapEvolutionState(snapshot.state) ? 'confirmed' : 'unknown');

      if (kind === 'not_found' || kind === 'invalid') {
        return kind === 'not_found' ? { kind: 'not_found' } : { kind: 'invalid' };
      }
      if (kind === 'unknown') {
        return { kind: 'unknown', raw: snapshot.state };
      }

      const status = mapEvolutionState(snapshot.state);
      if (status === null) {
        return { kind: 'unknown', raw: snapshot.state };
      }
      if (status === WhatsAppInstanceStatus.CONNECTED) {
        this.signalsFor(instanceName).lastOpenAt = Date.now();
      }
      return { kind: 'confirmed', status, raw: snapshot.state };
    } catch (error) {
      return { kind: 'unavailable', error };
    }
  }

  private findConnectionRowByName(instanceName: string): Promise<ConnectionRow | null> {
    return this.prisma.whatsAppInstance.findUnique({
      where: { instanceName },
      select: {
        id: true,
        tenantId: true,
        instanceName: true,
        status: true,
        connectionObservedAt: true,
        connectionRequestedAt: true,
        connectionStatusReason: true,
        connectionVersion: true,
        connectionStateVersion: true,
        connectionIntent: true,
      },
    });
  }

  /**
   * Allocates a DB-backed generation before reading the provider. The row
   * increment is atomic, so two processes/workers can never share a generation.
   * The later confirmed write only succeeds while it is still the newest one.
   */
  private async beginConnectionGeneration(id: string): Promise<ConnectionRow> {
    const updated = await this.prisma.whatsAppInstance.update({
      where: { id },
      data: { connectionVersion: { increment: 1 } },
      select: {
        id: true,
        tenantId: true,
        instanceName: true,
        status: true,
        connectionObservedAt: true,
        connectionRequestedAt: true,
        connectionStatusReason: true,
        connectionVersion: true,
        connectionStateVersion: true,
        connectionIntent: true,
      },
    });

    const row = updated?.id
      ? updated
      : await this.prisma.whatsAppInstance.findUnique({
          where: { id },
          select: {
            id: true,
            tenantId: true,
            instanceName: true,
            status: true,
            connectionObservedAt: true,
            connectionRequestedAt: true,
            connectionStatusReason: true,
            connectionVersion: true,
            connectionStateVersion: true,
            connectionIntent: true,
          },
        });

    if (!row) {
      throw new EvolutionRequestError('WhatsApp instance disappeared during connection update');
    }

    const normalized = normalizeConnectionRow(row);
    return normalized;
  }

  private async applyConfirmedState(
    current: ConnectionRow,
    status: WhatsAppInstanceStatus,
    options: ConnectionObservationOptions,
  ): Promise<AppliedConnectionObservation> {
    const source = options.source ?? 'webhook';
    const observedAt = new Date();
    // A periodic read carries no reason. It must not erase the reason the
    // provider reported when the session actually closed.
    const reason =
      options.reason ??
      (options.intent === undefined && status === current.status
        ? current.connectionStatusReason
        : null);
    const data: Prisma.WhatsAppInstanceUpdateManyMutationInput = {
      status,
      connectionObservedAt: observedAt,
      connectionStatusReason: reason,
    };
    if (options.intent !== undefined) {
      data.connectionIntent = options.intent;
    } else if (source === 'disconnect') {
      data.connectionIntent = WhatsAppConnectionIntent.DISCONNECT;
    }
    if (status === WhatsAppInstanceStatus.DISCONNECTED || status === WhatsAppInstanceStatus.ERROR) {
      data.connectionRequestedAt = null;
    }

    const version = current.connectionVersion;
    let lostRace = false;

    if (options.intent !== undefined) {
      // Explicit intent (manual disconnect) always wins over readings. The
      // token was allocated at the start of the operation, so an older reading
      // can no longer overwrite it.
      await this.prisma.whatsAppInstance.update({
        where: { id: current.id },
        data: { ...data, connectionStateVersion: version },
      });
    } else {
      // Only a confirmed state advances the persisted generation. Inconclusive
      // verifications bump the allocation counter but must not invalidate a
      // confirmed write that is still in flight.
      const applied = await this.prisma.whatsAppInstance.updateMany({
        where: {
          id: current.id,
          connectionStateVersion: { lt: version },
        },
        data: { ...data, connectionStateVersion: version },
      });
      lostRace = applied.count === 0;
    }

    if (lostRace) {
      const latest = await this.findConnectionRowByName(current.instanceName);
      this.logConnection('observation.ignored_stale', {
        instanceId: current.id,
        tenantId: current.tenantId,
        instanceName: current.instanceName,
        operation: source,
        previousStatus: current.status,
        providerStatus: status,
        version: current.connectionVersion,
        currentVersion: latest?.connectionVersion ?? null,
        reason: 'newer_generation_won',
      });
      return this.observationResult(
        latest ?? current,
        latest?.status ?? current.status,
        observedAt,
        latest?.connectionStatusReason ?? null,
        source,
        false,
        latest?.connectionVersion ?? current.connectionVersion,
        true,
      );
    }

    const changed = current.status !== status;
    if (status !== WhatsAppInstanceStatus.CONNECTING) {
      this.clearConnectionQr(current.id);
    }

    if (changed || options.intent !== undefined) {
      this.logConnection('applied', {
        instanceId: current.id,
        tenantId: current.tenantId,
        instanceName: current.instanceName,
        operation: source,
        previousStatus: current.status,
        providerStatus: status,
        observedAt: observedAt.toISOString(),
        eventTime: options.observedAt?.toISOString() ?? null,
        receivedAt: options.receivedAt?.toISOString() ?? null,
        reason,
        attemptId: options.attemptId ?? null,
        version,
      });
    }

    if (status === WhatsAppInstanceStatus.CONNECTED) {
      this.restoreStates.delete(current.id);
    } else {
      await this.interruptHistorySync(current.instanceName, source);
    }

    if (changed) {
      this.realtime.emitToTenant(current.tenantId, 'whatsapp.instance.updated', {
        instanceId: current.id,
        status,
        previousStatus: current.status,
        reason,
      });

      if (status === WhatsAppInstanceStatus.CONNECTED) {
        await this.releaseDuplicateSessions(current);
        await this.syncContactsOnConnect(current);
      }
    }

    return this.observationResult(current, status, observedAt, reason, source, changed, version);
  }

  private isWithinConnectGrace(
    current: ConnectionRow,
    status: WhatsAppInstanceStatus,
    reason: number | null,
    source: ConnectionObservationSource,
  ): boolean {
    if (
      current.status !== WhatsAppInstanceStatus.CONNECTING ||
      status !== WhatsAppInstanceStatus.DISCONNECTED ||
      source === 'disconnect' ||
      TERMINAL_DISCONNECT_REASONS.has(reason ?? 0) ||
      !current.connectionRequestedAt
    ) {
      return false;
    }
    return (
      Date.now() - current.connectionRequestedAt.getTime() <
      this.config.get('WHATSAPP_CONNECT_FLOW_GRACE_MS')
    );
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
    this.recordProviderActivity(instance.instanceName, 'connecting', null);
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
    let instances: RestoreCandidate[];
    try {
      instances = await this.prisma.whatsAppInstance.findMany({
        where: { active: true },
        select: {
          id: true,
          tenantId: true,
          instanceName: true,
          status: true,
          connectionIntent: true,
          connectionStatusReason: true,
          connectionObservedAt: true,
        },
        orderBy: { connectionRequestedAt: { sort: 'desc', nulls: 'last' } },
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
    const snapshot = await this.loadProviderSnapshot();

    for (const instance of instances) {
      await this.runAsTenant(instance.tenantId, async () => {
        try {
          const result = await this.verifyConnectionState(instance.instanceName, {
            source: 'reconcile',
            receivedAt: new Date(),
          });
          if (result?.changed) {
            changed += 1;
          }
          // Reconnectable closes such as the 440 conflict are not reported by
          // webhook, so a duplicated number can flap while the CRM still shows
          // CONNECTED. Instances are scanned from the most recent connection
          // request, which therefore keeps the number.
          if (snapshot && result?.status === WhatsAppInstanceStatus.CONNECTED && !result.changed) {
            await this.releaseDuplicateSessions(instance, snapshot);
          }
          if (result?.status === WhatsAppInstanceStatus.DISCONNECTED) {
            await this.restoreAbandonedSession(instance, 'reconcile', snapshot);
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
   * Evolution 2.4 makes a single reconnect attempt after a recoverable close
   * and neither retries it nor sends a webhook when it fails: the instance stays
   * `close` while the stored session, and the linked device on the phone, are
   * still valid. A manual connect then restores it without a QR code. This does
   * the same automatically and with bounded attempts, only for a session the
   * provider abandoned: never after a manual disconnect, never for a close that
   * requires a new pairing and never inside the provider's own reconnect window.
   * `row` is the state persisted before the current verification.
   */
  private async restoreAbandonedSession(
    row: RestoreCandidate,
    trigger: RestoreTrigger,
    snapshot: EvolutionInstanceSummary[] | null,
  ): Promise<boolean> {
    const context = {
      instanceId: row.id,
      tenantId: row.tenantId,
      instanceName: row.instanceName,
      trigger,
      reason: row.connectionStatusReason,
    };

    // Routine skips repeat on every reconciliation tick, so they are only
    // logged when a send was blocked by them.
    const skip = (skipped: string, extra: Record<string, unknown> = {}): false => {
      if (trigger === 'send' || UNEXPECTED_RESTORE_SKIPS.has(skipped)) {
        this.logConnection('restore.skipped', { ...context, skipped, ...extra });
      }
      return false;
    };

    const skipped = this.restoreSkipReason(row);
    const state = this.restoreStates.get(row.id);
    if (skipped || !state) {
      return !skipped || skipped === 'disabled' || skipped === 'not_disconnected'
        ? false
        : skip(skipped);
    }

    const providerInstances = snapshot ?? (await this.loadProviderSnapshot());
    if (!providerInstances) {
      return skip('provider_unavailable');
    }
    const provider = providerInstances.find((entry) => entry.name === row.instanceName);
    if (!provider) {
      return skip('provider_instance_missing');
    }
    if (!normalizeOwnerNumber(provider.ownerJid)) {
      return skip('never_paired');
    }

    const live = await this.readProviderSnapshot(row.instanceName);
    if (live.kind !== 'confirmed' || live.status !== WhatsAppInstanceStatus.DISCONNECTED) {
      return skip('provider_not_closed', {
        providerResult: live.kind,
        providerState: live.kind === 'confirmed' || live.kind === 'unknown' ? live.raw : null,
      });
    }

    // Checked again right before taking the lock: the reads above yield, and two
    // concurrent connects would open two sockets for the same session.
    if (this.connectionOperations.has(row.id)) {
      return skip('operation_in_progress');
    }
    this.connectionOperations.set(row.id, 'restore');
    const startedAt = Date.now();
    const attempt = state.attempts + 1;
    this.logConnection('restore.started', {
      ...context,
      attempt,
      maxAttempts: RESTORE_MAX_ATTEMPTS,
      closedForMs: startedAt - state.closedSince,
    });

    try {
      let response: unknown;
      try {
        response = await this.evolution.connect(row.instanceName);
      } catch (error) {
        // The provider could not be reached: this says nothing about the
        // session, so it does not consume an attempt.
        this.logConnection('restore.failed', {
          ...context,
          attempt,
          counted: false,
          error: sanitizeConnectionError(error),
        });
        return false;
      }

      const outcome =
        isRecord(response) && response.error === true
          ? 'rejected'
          : await this.waitForRestoredSession(row, startedAt);

      if (outcome === 'open') {
        const result = await this.verifyConnectionState(row.instanceName, {
          source: 'restore',
          receivedAt: new Date(),
        });
        if (result?.status === WhatsAppInstanceStatus.CONNECTED) {
          this.restoreStates.delete(row.id);
          this.logConnection('restore.succeeded', {
            ...context,
            attempt,
            durationMs: Date.now() - startedAt,
          });
          return true;
        }
      }

      // A QR code means the provider no longer holds the session: only a new
      // pairing helps, and further attempts would just restart the QR cycle.
      const exhausted = outcome === 'qr' || attempt >= RESTORE_MAX_ATTEMPTS;
      state.attempts = attempt;
      state.nextAttemptAt = Date.now() + RESTORE_BACKOFF_BASE_MS * 2 ** (attempt - 1);
      state.exhausted = exhausted;
      const event =
        outcome === 'qr'
          ? 'restore.requires_pairing'
          : exhausted
            ? 'restore.exhausted'
            : 'restore.failed';
      this.logger.warn(
        `whatsapp.connection.${event} ${JSON.stringify({
          ...context,
          attempt,
          counted: true,
          outcome,
          providerMessage:
            outcome === 'rejected' && isRecord(response)
              ? sanitizeProviderText(readString(response.message))
              : null,
          durationMs: Date.now() - startedAt,
        })}`,
      );
      return false;
    } finally {
      this.connectionOperations.delete(row.id);
    }
  }

  private restoreSkipReason(row: RestoreCandidate): string | null {
    if (!this.config.get('WHATSAPP_AUTO_RESTORE_ENABLED') || !this.evolution.configured) {
      return 'disabled';
    }
    if (row.status !== WhatsAppInstanceStatus.DISCONNECTED) {
      return 'not_disconnected';
    }
    if (row.connectionIntent === WhatsAppConnectionIntent.DISCONNECT) {
      return 'manual_disconnect_intent';
    }
    if (
      row.connectionStatusReason !== null &&
      NON_RESTORABLE_REASONS.has(row.connectionStatusReason)
    ) {
      return 'requires_pairing_reason';
    }
    const now = Date.now();
    let state = this.restoreStates.get(row.id);
    if (!state) {
      state = {
        closedSince: row.connectionObservedAt?.getTime() ?? now,
        attempts: 0,
        nextAttemptAt: 0,
        exhausted: false,
      };
      this.restoreStates.set(row.id, state);
    }
    // The provider reconnects a recoverable close by itself a few seconds
    // later. Calling connect inside that window would open a second socket for
    // the same session, and both would keep replacing each other.
    const minClosedMs = this.config.get('WHATSAPP_AUTO_RESTORE_MIN_CLOSED_MS');
    if (now - state.closedSince < minClosedMs) {
      return 'within_provider_reconnect_window';
    }
    // Any recent connection event means the provider is still working on this
    // session (reconnecting, or two sockets replacing each other). A connect
    // now would add one more socket to it.
    if (now - this.signalsFor(row.instanceName).lastActivityAt < minClosedMs) {
      return 'provider_active';
    }
    if (state.exhausted) {
      return 'attempts_exhausted';
    }
    if (now < state.nextAttemptAt) {
      return 'backoff';
    }
    if (this.connectionOperations.has(row.id)) {
      return 'operation_in_progress';
    }
    return null;
  }

  private async waitForRestoredSession(
    row: RestoreCandidate,
    startedAt: number,
  ): Promise<'open' | 'qr' | 'not_open'> {
    const deadline = startedAt + this.config.get('WHATSAPP_AUTO_RESTORE_WAIT_MS');
    const qrIssued = (): boolean => {
      const qr = this.qrCache.get(row.id);
      return qr !== undefined && qr.updatedAt.getTime() >= startedAt;
    };

    while (Date.now() < deadline) {
      const snapshot = await this.readProviderSnapshot(row.instanceName);
      if (snapshot.kind === 'confirmed' && snapshot.status === WhatsAppInstanceStatus.CONNECTED) {
        return 'open';
      }
      if (qrIssued()) {
        return 'qr';
      }
      await delay(Math.min(RESTORE_POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
    }

    return qrIssued() ? 'qr' : 'not_open';
  }

  private signalsFor(instanceName: string): ProviderSignals {
    let signals = this.providerSignals.get(instanceName);
    if (!signals) {
      signals = { lastActivityAt: 0, lastOpenAt: 0, conflictCloses: [], stormLoggedAt: 0 };
      this.providerSignals.set(instanceName, signals);
    }
    return signals;
  }

  private isProviderActive(instanceName: string, windowMs: number): boolean {
    return Date.now() - this.signalsFor(instanceName).lastActivityAt < windowMs;
  }

  private isFlapping(instanceName: string, reason: number | null): boolean {
    const windowMs = this.config.get('WHATSAPP_CONNECTION_FLAP_WINDOW_MS');
    if (!windowMs || (reason !== null && FINAL_CLOSE_REASONS.has(reason))) {
      return false;
    }
    return Date.now() - this.signalsFor(instanceName).lastOpenAt < windowMs;
  }

  /**
   * Connection webhooks of a connection still in progress show the provider is
   * working on the session. Repeated `close` 440 (stream conflict "replaced")
   * means two sockets share the same credentials and keep replacing each
   * other: Evolution reconnects every one of them, so the loop never ends by
   * itself. Only restarting the Evolution process (or a new pairing) stops it,
   * so it is reported loudly.
   */
  private recordProviderActivity(
    instanceName: string,
    state: string | null,
    reason: number | null,
    eventType?: string,
  ): void {
    const now = Date.now();
    const signals = this.signalsFor(instanceName);
    const normalized = state?.toLowerCase() ?? null;
    // After `refused`, a logout or a close it does not reconnect, Evolution
    // leaves the session alone: only events of a connection still in progress
    // mean it will keep working on it.
    const providerGaveUp =
      eventType === 'logout.instance' ||
      eventType === 'status.instance' ||
      normalized === 'refused' ||
      (normalized === 'close' && reason !== null && FINAL_CLOSE_REASONS.has(reason));
    if (!providerGaveUp) {
      signals.lastActivityAt = now;
    }

    if (reason !== SESSION_REPLACED_REASON || state?.toLowerCase() !== 'close') {
      return;
    }
    signals.conflictCloses = signals.conflictCloses
      .filter((at) => now - at < CONFLICT_STORM_WINDOW_MS)
      .concat(now);
    if (
      signals.conflictCloses.length >= CONFLICT_STORM_THRESHOLD &&
      now - signals.stormLoggedAt >= CONFLICT_STORM_LOG_INTERVAL_MS
    ) {
      signals.stormLoggedAt = now;
      this.logger.warn(
        `whatsapp.connection.conflict_storm ${JSON.stringify({
          instanceName,
          conflicts: signals.conflictCloses.length,
          windowMs: CONFLICT_STORM_WINDOW_MS,
          hint: 'two provider sockets share this session and keep replacing each other; restart the Evolution container',
        })}`,
      );
    }
  }

  private async loadProviderSnapshot(): Promise<EvolutionInstanceSummary[] | null> {
    try {
      return await this.evolution.fetchInstances();
    } catch (error) {
      this.logger.warn(
        `Could not load provider instances for duplicate check: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return null;
    }
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
    return this.enqueueHistoryOperation(instanceName, () =>
      this.applyHistorySyncUpdateUnlocked(instanceName, update),
    );
  }

  private async applyHistorySyncUpdateUnlocked(
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
        historySyncChunks: true,
        historySyncMessages: true,
        historySyncStartedAt: true,
        historySyncCompletedAt: true,
        historySyncUpdatedAt: true,
        historySyncError: true,
      },
    });
    if (!instance) {
      return null;
    }

    const current = toHistorySyncState(instance);

    if (update.onlyIfSyncing && current.status !== WhatsAppHistorySyncStatus.SYNCING) {
      return current;
    }

    const now = update.observedAt ?? new Date();
    if (current.updatedAt && now.getTime() < current.updatedAt.getTime()) {
      return current;
    }

    const observed = normalizeHistoryProgress(update.progress);
    const chunks = normalizeHistoryCount(update.chunks);
    const messages = normalizeHistoryCount(update.messages);

    let status = current.status;
    let progress = current.progress;
    let currentChunks = current.chunks;
    let currentMessages = current.messages;
    let startedAt = current.startedAt;
    let completedAt = current.completedAt;
    let error = current.error;

    if (update.completed) {
      status = WhatsAppHistorySyncStatus.COMPLETED;
      progress = 100;
      if (chunks !== null) {
        currentChunks = maxCount(currentChunks, chunks);
      }
      if (messages !== null) {
        currentMessages = messages;
      }
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
      if (chunks !== null) {
        currentChunks = maxCount(currentChunks, chunks);
      }
      if (messages !== null) {
        currentMessages = messages;
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
        currentChunks = chunks;
        currentMessages = messages;
        startedAt = now;
        completedAt = null;
        error = null;
      }
    } else {
      status = WhatsAppHistorySyncStatus.SYNCING;
      if (observed !== null && (progress === null || observed >= progress)) {
        progress = observed;
      }
      if (chunks !== null) {
        currentChunks = maxCount(currentChunks, chunks);
      }
      if (messages !== null) {
        currentMessages = messages;
      }
      startedAt ??= now;
      completedAt = null;
      error = null;
    }

    const changed =
      status !== current.status ||
      progress !== current.progress ||
      currentChunks !== current.chunks ||
      currentMessages !== current.messages ||
      !sameDate(startedAt, current.startedAt) ||
      !sameDate(completedAt, current.completedAt) ||
      error !== current.error;

    if (changed) {
      const applied = await this.prisma.whatsAppInstance.updateMany({
        where: {
          id: instance.id,
          OR: [{ historySyncUpdatedAt: null }, { historySyncUpdatedAt: { lte: now } }],
        },
        data: {
          historySyncStatus: status,
          historySyncProgress: progress,
          historySyncChunks: currentChunks,
          historySyncMessages: currentMessages,
          historySyncStartedAt: startedAt,
          historySyncCompletedAt: completedAt,
          historySyncUpdatedAt: now,
          historySyncError: error,
        },
      });

      if (applied.count === 0) {
        const latest = await this.prisma.whatsAppInstance.findUnique({
          where: { id: instance.id },
          select: {
            id: true,
            tenantId: true,
            historySyncStatus: true,
            historySyncProgress: true,
            historySyncChunks: true,
            historySyncMessages: true,
            historySyncStartedAt: true,
            historySyncCompletedAt: true,
            historySyncUpdatedAt: true,
            historySyncError: true,
          },
        });
        return latest ? toHistorySyncState(latest) : null;
      }
    }

    return {
      instanceId: instance.id,
      tenantId: instance.tenantId,
      status,
      progress,
      chunks: currentChunks,
      messages: currentMessages,
      startedAt,
      completedAt,
      updatedAt: changed ? now : current.updatedAt,
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

  /**
   * Serializes history-sync writes per instance in this process. The provider
   * can deliver a batch, a notification and the completion event close
   * together; without serialization a stale read could overwrite newer
   * progress. The conditional update in `applyHistorySyncUpdate` remains as a
   * second line of defense.
   */
  private async enqueueHistoryOperation<T>(instanceName: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.historyOperations.get(instanceName) ?? Promise.resolve();
    const run = previous.then(
      () => fn(),
      () => fn(),
    );
    const guard = run.then(
      () => undefined,
      () => undefined,
    );
    this.historyOperations.set(instanceName, guard);

    try {
      return await run;
    } finally {
      if (this.historyOperations.get(instanceName) === guard) {
        this.historyOperations.delete(instanceName);
      }
    }
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
    // An explicit request always wins over an in-flight asynchronous reading:
    // its token is newer than any observation that started before it. Both
    // writes share a transaction so the intent and its generation agree.
    await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.whatsAppInstance.update({
        where: { id },
        data: {
          status,
          connectionObservedAt: new Date(),
          connectionStatusReason: null,
          connectionRequestedAt: options.observedAt,
          connectionIntent: WhatsAppConnectionIntent.CONNECT,
          connectionVersion: { increment: 1 },
        },
        select: { connectionVersion: true },
      });
      await tx.whatsAppInstance.update({
        where: { id },
        data: { connectionStateVersion: bumped.connectionVersion },
      });
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
    version: number,
    ignored = false,
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
      version,
      ...(ignored ? { ignored: true } : {}),
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

  /**
   * WhatsApp keeps one live session per device credential. When the same number
   * is also linked to another Evolution instance, the sessions keep replacing
   * each other (stream conflict 440) and the provider reconnects them in a loop,
   * so the number "keeps disconnecting". The instance that has just connected is
   * the one the operator wants: the other sessions of the same number are logged
   * out, either orphan provider instances or instances of the same tenant.
   * Another tenant's session is never touched, only reported. The periodic
   * reconciliation passes a provider snapshot it already loaded.
   */
  private async releaseDuplicateSessions(
    instance: { id: string; tenantId: string; instanceName: string },
    snapshot?: EvolutionInstanceSummary[],
  ): Promise<void> {
    try {
      await this.releaseDuplicateSessionsUnchecked(instance, snapshot);
    } catch (error) {
      this.logger.warn(
        `Could not release duplicate sessions for instance ${instance.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private async releaseDuplicateSessionsUnchecked(
    instance: { id: string; tenantId: string; instanceName: string },
    snapshot?: EvolutionInstanceSummary[],
  ): Promise<void> {
    const providerInstances = snapshot ?? (await this.evolution.fetchInstances());

    const current = providerInstances.find((entry) => entry.name === instance.instanceName);
    const ownerNumber = normalizeOwnerNumber(current?.ownerJid ?? null);
    if (!ownerNumber) {
      return;
    }

    const duplicates = providerInstances.filter(
      (entry) =>
        entry.name !== instance.instanceName &&
        entry.state?.toLowerCase() !== 'close' &&
        normalizeOwnerNumber(entry.ownerJid) === ownerNumber,
    );
    if (duplicates.length === 0) {
      return;
    }

    const known = await this.prisma.whatsAppInstance.findMany({
      where: { instanceName: { in: duplicates.map((entry) => entry.name) } },
      select: { id: true, tenantId: true, instanceName: true },
    });
    const knownByName = new Map(known.map((entry) => [entry.instanceName, entry]));

    for (const duplicate of duplicates) {
      const owned = knownByName.get(duplicate.name);
      const payload = {
        instanceId: instance.id,
        tenantId: instance.tenantId,
        instanceName: instance.instanceName,
        duplicateInstanceName: duplicate.name,
        duplicateInstanceId: owned?.id ?? null,
        duplicateState: duplicate.state,
      };

      if (owned && owned.tenantId !== instance.tenantId) {
        this.logConnection('duplicate_session_foreign_tenant', payload);
        continue;
      }

      try {
        await this.evolution.disconnect(duplicate.name);
      } catch (error) {
        this.logConnection('duplicate_session_release_failed', {
          ...payload,
          error: error instanceof Error ? error.message : 'unknown',
        });
        continue;
      }

      duplicate.state = 'close';
      this.logConnection('duplicate_session_released', payload);
      if (owned) {
        await this.applyConnectionObservation(duplicate.name, 'close', {
          observedAt: new Date(),
          source: 'disconnect',
          reason: SESSION_REPLACED_REASON,
        });
      }
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

  private async ensureInstanceAndConnect(instance: {
    id: string;
    instanceName: string;
  }): Promise<ConnectionAttempt> {
    const { instanceName } = instance;
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

    // On `close`, Evolution opens a new socket without ending the previous
    // one. If it is still reconnecting the session by itself, a connect now
    // creates a duplicate that replaces the other forever (stream conflict
    // 440). Wait for its own reconnection instead.
    const settleMs = this.config.get('WHATSAPP_PROVIDER_SETTLE_MS');
    if (state === 'close' && this.isProviderActive(instanceName, settleMs)) {
      const settled = await this.waitForProviderToSettle(instanceName, settleMs);
      if (settled === 'open') {
        return { raw: null, state: 'open' };
      }
      if (settled === 'active') {
        throw new WhatsAppProviderReconnectingError();
      }
    }

    const attempt = await this.requestConnection(instance);
    if (attempt !== null) {
      return attempt;
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

  private async waitForProviderToSettle(
    instanceName: string,
    settleMs: number,
  ): Promise<'open' | 'quiet' | 'active'> {
    const deadline = Date.now() + settleMs;

    while (Date.now() < deadline) {
      await delay(Math.min(CONNECT_POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
      const snapshot = await this.readProviderSnapshot(instanceName);
      if (snapshot.kind === 'confirmed' && snapshot.status === WhatsAppInstanceStatus.CONNECTED) {
        return 'open';
      }
      if (
        snapshot.kind === 'confirmed' &&
        snapshot.status === WhatsAppInstanceStatus.DISCONNECTED &&
        !this.isProviderActive(instanceName, settleMs)
      ) {
        return 'quiet';
      }
    }

    return this.isProviderActive(instanceName, settleMs) ? 'active' : 'quiet';
  }

  /**
   * A single connect. Without a ticket in the answer, the provider is either
   * restoring the stored session (it opens without a QR code) or the QR is not
   * ready yet. Connect is only repeated while the provider reports
   * `connecting`, where Evolution just returns the current QR; on `close` it
   * would open another socket for the same session.
   */
  private async requestConnection(instance: {
    id: string;
    instanceName: string;
  }): Promise<ConnectionAttempt | null> {
    const startedAt = Date.now();
    try {
      const raw = await this.evolution.connect(instance.instanceName);
      if (hasConnectionTicket(extractConnectionTicket(raw))) {
        return { raw, state: 'close' };
      }
    } catch (error) {
      if (!isEvolutionMissing(error)) {
        throw error;
      }
      return null;
    }

    const deadline = startedAt + CONNECT_RESTORE_WAIT_MS;
    for (;;) {
      const snapshot = await this.readProviderSnapshot(instance.instanceName);
      if (snapshot.kind === 'confirmed' && snapshot.status === WhatsAppInstanceStatus.CONNECTED) {
        return { raw: null, state: 'open' };
      }

      const cached = this.qrCache.get(instance.id);
      if (cached && cached.updatedAt.getTime() >= startedAt) {
        return {
          raw: { base64: cached.qrCodeBase64, code: cached.code, pairingCode: cached.pairingCode },
          state: 'connecting',
        };
      }

      if (snapshot.kind === 'confirmed' && snapshot.status === WhatsAppInstanceStatus.DISCONNECTED) {
        return null;
      }

      if (
        snapshot.kind === 'confirmed' &&
        snapshot.status === WhatsAppInstanceStatus.CONNECTING &&
        Date.now() - startedAt >= CONNECT_QR_GRACE_MS
      ) {
        const raw = await this.evolution.connect(instance.instanceName).catch(() => null);
        if (hasConnectionTicket(extractConnectionTicket(raw))) {
          return { raw, state: 'connecting' };
        }
      }

      if (Date.now() >= deadline) {
        return null;
      }
      await delay(Math.min(CONNECT_POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
    }
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
        if (this.isProviderDisconnected(providerState)) {
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

  private isProviderDisconnected(state: {
    state: string;
    kind?: 'confirmed' | 'unknown' | 'invalid' | 'not_found';
  }): boolean {
    // Only the specific endpoint can confirm the logout. A missing instance is
    // a reliable `not_found`; an unknown/invalid body is not.
    if (state.kind === 'not_found') {
      return true;
    }
    return mapEvolutionState(state.state) === WhatsAppInstanceStatus.DISCONNECTED;
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
    // The completion event is small and always useful for the history-sync
    // indicator. Full history batches are only subscribed when import is
    // explicitly enabled; the indicator can also use the progress carried by
    // the history notification event.
    const events = ['MESSAGING_HISTORY_SET', ...WEBHOOK_EVENTS];
    return this.config.get('WHATSAPP_HISTORY_IMPORT_ENABLED')
      ? ['MESSAGES_SET', ...events]
      : events;
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

interface HistorySyncRow {
  id: string;
  tenantId: string;
  historySyncStatus: WhatsAppHistorySyncStatus;
  historySyncProgress: number | null;
  historySyncChunks: number | null;
  historySyncMessages: number | null;
  historySyncStartedAt: Date | null;
  historySyncCompletedAt: Date | null;
  historySyncUpdatedAt: Date | null;
  historySyncError: string | null;
}

function toHistorySyncState(row: HistorySyncRow): AppliedHistorySyncState {
  return {
    instanceId: row.id,
    tenantId: row.tenantId,
    status: row.historySyncStatus,
    progress: row.historySyncProgress,
    chunks: row.historySyncChunks,
    messages: row.historySyncMessages,
    startedAt: row.historySyncStartedAt,
    completedAt: row.historySyncCompletedAt,
    updatedAt: row.historySyncUpdatedAt,
    error: row.historySyncError,
    changed: false,
  };
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
  historySyncChunks?: number | null;
  historySyncMessages?: number | null;
  historySyncStartedAt?: Date | null;
  historySyncCompletedAt?: Date | null;
  historySyncUpdatedAt?: Date | null;
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
      chunks: instance.historySyncChunks ?? null,
      messages: instance.historySyncMessages ?? null,
      startedAt: instance.historySyncStartedAt ?? null,
      completedAt: instance.historySyncCompletedAt ?? null,
      updatedAt: instance.historySyncUpdatedAt ?? null,
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

/** `5511999999999:12@s.whatsapp.net` -> `5511999999999` (device suffix removed). */
export function normalizeOwnerNumber(ownerJid: string | null): string | null {
  if (!ownerJid) {
    return null;
  }
  const user = ownerJid.split('@')[0]?.split(':')[0] ?? '';
  const digits = user.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
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

function normalizeHistoryCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.trunc(value);
}

function maxCount(current: number | null, next: number): number {
  return current === null || next > current ? next : current;
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

/** Keeps provider text short and without phone numbers before it is logged. */
function sanitizeProviderText(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/\d{8,}/g, '<number>').slice(0, 200);
}

function sanitizeConnectionError(error: unknown): string | null {
  if (error instanceof EvolutionRequestError) {
    const status = error.httpStatus ? ` (${error.httpStatus})` : '';
    const detail = error.providerMessage ? `: ${error.providerMessage}` : '';
    return `${error.message}${status}${detail}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return null;
}

function normalizeConnectionRow(row: ConnectionRow): ConnectionRow {
  return {
    ...row,
    connectionStatusReason: row.connectionStatusReason ?? null,
    connectionVersion: row.connectionVersion ?? 0,
    connectionStateVersion: row.connectionStateVersion ?? 0,
    connectionIntent: row.connectionIntent ?? WhatsAppConnectionIntent.NONE,
  };
}
