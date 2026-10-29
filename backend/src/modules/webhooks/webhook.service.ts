import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import { AppException } from '../../common/errors/app.exception.js';
import {
  alternateDestination,
  pickDestination,
  type DestinationInput,
} from '../../common/whatsapp/destination.js';
import {
  extractPreviewUrlsFromText,
  MAX_PREVIEW_DESCRIPTION_LENGTH,
  MAX_PREVIEW_TITLE_LENGTH,
  normalizePreviewUrl,
  previewDomain,
  sanitizePreviewText,
  type LinkPreviewMetadata,
} from '../../common/link-preview/link-preview.js';
import { isGroupJid, lidFromJid, phoneFromJid } from '../../common/whatsapp/jid.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { JOB_NAMES, JOB_QUEUE, type JobQueue } from '../../infrastructure/queue/job-queue.types.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { MessagesService, type QuotedMessageInfo } from '../conversations/messages.service.js';
import { TranscriptionSettingsService } from '../transcription/transcription-settings.service.js';
import { WhatsAppConversationSyncService } from '../whatsapp/whatsapp-conversation-sync.service.js';
import { WhatsAppDirectoryService } from '../whatsapp/whatsapp-directory.service.js';
import {
  WhatsAppInstancesService,
  type AppliedHistorySyncState,
  type ResolvedInstance,
} from '../whatsapp/whatsapp-instances.service.js';
import { WebhookProcessingError } from './webhooks.errors.js';

export interface WebhookIngestResult {
  accepted: boolean;
  ignored?: string;
  conversationId?: string;
  messageId?: string;
}

export interface HistoryIngestResult {
  received: number;
  imported: number;
  skipped: number;
  failed: number;
  conversations: number;
}

const HISTORY_REALTIME_WINDOW_MS = 15 * 60 * 1000;
const WEBHOOK_REPLAY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_REPLAY_LIMIT = 100;
const PRESENCE_DIRECTORY_TTL_MS = 30_000;
const PRESENCE_NAME_TTL_MS = 15_000;
const PRESENCE_DIRECTORY_CACHE_LIMIT = 500;

interface PresenceIdentity {
  name: string | null;
  phone: string | null;
}

interface PresenceNameEntry {
  name: string | null;
  expiresAt: number;
}

interface PresenceDirectory {
  expiresAt: number;
  byJid: Map<string, PresenceIdentity | null>;
  byLid: Map<string, PresenceIdentity | null>;
  byPhone: Map<string, PresenceIdentity | null>;
  contactNames: Map<string, string | null>;
  senderNames: Map<string, PresenceNameEntry>;
}

interface PresenceActivity {
  participantId: string;
  state: PresenceState;
  lastSeenAt: Date | null;
  identity: PresenceIdentity;
}

const CONVERSATION_IDENTITY_SELECT = {
  id: true,
  status: true,
  contactId: true,
  groupName: true,
  isGroup: true,
  externalLid: true,
} satisfies Prisma.ConversationSelect;

type ConversationIdentity = Prisma.ConversationGetPayload<{
  select: typeof CONVERSATION_IDENTITY_SELECT;
}>;

class HistoryIngestError extends Error {
  constructor(readonly result: HistoryIngestResult) {
    super('History batch had failed messages');
    this.name = 'HistoryIngestError';
  }
}

@Injectable()
export class WebhookService implements OnModuleInit {
  private readonly logger = new Logger(WebhookService.name);
  private readonly presenceDirectories = new Map<string, PresenceDirectory>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly instances: WhatsAppInstancesService,
    private readonly contacts: ContactsService,
    private readonly directory: WhatsAppDirectoryService,
    private readonly conversationSync: WhatsAppConversationSyncService,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    private readonly transcriptionSettings: TranscriptionSettingsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.WEBHOOK_PROCESS, (payload) =>
      this.replayRecordedEvent(payload),
    );
    void this.replayPendingEvents();
  }

  /**
   * Requeues events that were claimed but not acknowledged before a restart or
   * a processing failure. The payload is already stored in `webhook_events`, so
   * replay is bounded and survives process restarts without an in-memory queue.
   */
  private async replayPendingEvents(): Promise<void> {
    try {
      const pending = await this.prisma.webhookEvent.findMany({
        where: {
          processedAt: null,
          tenantId: { not: null },
          createdAt: { gte: new Date(Date.now() - WEBHOOK_REPLAY_LOOKBACK_MS) },
        },
        orderBy: { createdAt: 'asc' },
        take: WEBHOOK_REPLAY_LIMIT,
        select: { id: true },
      });

      for (const event of pending) {
        try {
          await this.queue.enqueue(
            JOB_NAMES.WEBHOOK_PROCESS,
            { webhookEventId: event.id },
            { jobId: event.id },
          );
        } catch (error) {
          this.logger.warn(
            `Could not enqueue webhook replay ${event.id}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Webhook replay scan failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async replayRecordedEvent(payload: Record<string, unknown>): Promise<void> {
    const webhookEventId =
      typeof payload.webhookEventId === 'string' ? payload.webhookEventId : null;
    if (!webhookEventId) {
      return;
    }

    const stored = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
      select: { id: true, payload: true, processedAt: true, createdAt: true },
    });
    if (!stored || stored.processedAt) {
      return;
    }

    await this.processEvolution(stored.payload, {
      scheduleRecovery: false,
      observedAt: stored.createdAt,
    });
    await this.markEventProcessed(webhookEventId);
  }

  async ingestEvolution(
    payload: unknown,
    options: { observedAt?: Date | null } = {},
  ): Promise<WebhookIngestResult> {
    try {
      const result = await this.processEvolution(payload, {
        scheduleRecovery: true,
        observedAt: options.observedAt ?? null,
      });
      this.traceWebhook(payload, result);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to process webhook event: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw error instanceof AppException ? error : new WebhookProcessingError(error);
    }
  }

  /**
   * Temporary, opt-in diagnostics (`WEBHOOK_DEBUG`). It records only metadata
   * and the processing decision, so no message body, token or credential leaks
   * into the logs; the raw payload is included only when `WEBHOOK_DEBUG_PAYLOAD`
   * is explicitly enabled and is redacted/truncated. Remove together with the two
   * env flags once the Evolution edit flow is confirmed in production.
   */
  private traceWebhook(payload: unknown, result: WebhookIngestResult): void {
    if (!this.config.get('WEBHOOK_DEBUG')) {
      return;
    }

    const record = isRecord(payload) ? payload : {};
    const eventType = readString(record.event) ?? 'unknown';
    const instanceName = readInstanceName(record);
    const data = isRecord(record.data) ? record.data : null;
    const key = data && isRecord(data.key) ? data.key : null;
    const rawMessage = data?.message;
    const { message } = unwrapViewOnce(rawMessage);
    const edit = data ? parseMessageEdit(data, message) : null;

    this.logger.debug(
      `webhook.trace ${JSON.stringify({
        event: eventType,
        instance: instanceName,
        externalMessageId:
          (key ? readString(key.id) : null) ?? (data ? readString(data.keyId) : null),
        originalMessageId: edit?.externalMessageId ?? null,
        fromMe: key?.fromMe === true || (data ? data.fromMe === true : false),
        messageType: data ? (readString(data.messageType) ?? readString(data.status)) : null,
        editDetected: edit !== null,
        normalizedType: edit?.type ?? null,
        normalizedContent: edit ? edit.content !== null : null,
        decision: result.ignored ?? (result.accepted ? 'accepted' : 'rejected'),
        conversationId: result.conversationId ?? null,
        messageId: result.messageId ?? null,
      })}`,
    );

    if (this.config.get('WEBHOOK_DEBUG_PAYLOAD')) {
      this.logger.debug(`webhook.payload ${JSON.stringify(redactPayload(payload))}`);
    }
  }

  private async processEvolution(
    payload: unknown,
    options: { scheduleRecovery: boolean; observedAt: Date | null } = {
      scheduleRecovery: true,
      observedAt: null,
    },
  ): Promise<WebhookIngestResult> {
    const observedAt = options.observedAt ?? new Date();
    if (!isRecord(payload)) {
      return { accepted: false, ignored: 'invalid_payload' };
    }

    const eventType = normalizeEventType(readString(payload.event) ?? 'unknown');
    const instanceName = readInstanceName(payload);
    if (!instanceName) {
      return { accepted: false, ignored: 'missing_instance' };
    }

    const instance = await this.instances.resolveByInstanceName(instanceName);
    if (!instance) {
      this.logger.warn(`Webhook for unknown or inactive instance: ${instanceName}`);
      return { accepted: false, ignored: 'unknown_instance' };
    }

    if (eventType === 'presence.update') {
      await this.handlePresence(instance, payload);
      return { accepted: true };
    }

    // QRs are short-lived pairing credentials. They are handled before
    // `recordEvent` so the base64 is never persisted in webhook_events nor
    // written to logs; only the administrators of the tenant receive it.
    if (eventType === 'qrcode.updated') {
      await this.instances.applyProviderQr(instance, payload.data, observedAt);
      return { accepted: true };
    }

    // History sync batches are large and idempotent at the message level.
    // Handling them before `recordEvent` avoids storing the whole batch payload
    // in webhook_events while still importing every missing message. A batch
    // failure is reported as 5xx so Evolution retries it instead of dropping it.
    if (eventType === 'messages.set') {
      if (!this.config.get('WHATSAPP_HISTORY_IMPORT_ENABLED')) {
        return { accepted: true, ignored: 'history_import_disabled' };
      }

      try {
        await this.handleMessagesSet(instance, payload);
        return { accepted: true };
      } catch (error) {
        throw error instanceof AppException ? error : new WebhookProcessingError(error);
      }
    }

    if (eventType === 'messaging-history.set') {
      if (!this.config.get('WHATSAPP_HISTORY_IMPORT_ENABLED')) {
        return { accepted: true, ignored: 'history_import_disabled' };
      }

      try {
        await this.handleMessagingHistorySet(instance, payload);
        return { accepted: true };
      } catch (error) {
        throw error instanceof AppException ? error : new WebhookProcessingError(error);
      }
    }

    const externalEventId = computeEventId(payload, eventType, instanceName);

    let claim: { id: string; duplicate: boolean };
    try {
      claim = await this.recordEvent({
        tenantId: instance.tenantId,
        externalEventId,
        eventType,
        payload,
      });
    } catch (error) {
      throw new WebhookProcessingError(error);
    }

    if (claim.duplicate) {
      return { accepted: true, ignored: 'duplicate_event' };
    }

    try {
      const result = await this.processRecordedEvent(instance, eventType, payload, observedAt);
      await this.markEventProcessed(claim.id);
      return result;
    } catch (error) {
      if (options.scheduleRecovery) {
        await this.enqueueRecovery(claim.id, error);
      }
      throw error instanceof AppException ? error : new WebhookProcessingError(error);
    }
  }

  private async processRecordedEvent(
    instance: ResolvedInstance,
    eventType: string,
    payload: Record<string, unknown>,
    observedAt: Date,
  ): Promise<WebhookIngestResult> {
    if (eventType === 'groups.upsert' || eventType === 'groups.update') {
      await this.handleGroupUpsert(instance, payload, eventType === 'groups.upsert');
      this.presenceDirectories.clear();
      return { accepted: true };
    }

    if (eventType === 'group-participants.update') {
      await this.handleGroupParticipantsUpdate(instance, payload);
      this.presenceDirectories.clear();
      return { accepted: true };
    }

    if (eventType === 'contacts.upsert' || eventType === 'contacts.update') {
      await this.handleContactSync(instance, payload);
      return { accepted: true };
    }

    if (eventType === 'chats.upsert' || eventType === 'chats.update' || eventType === 'chats.set') {
      await this.handleChatSync(instance, payload);
      return { accepted: true };
    }

    // Evolution v2 reports the session lifecycle as `connection.update`. It is
    // authoritative evidence of a degraded session (conflict, device_removed,
    // connection closed) that `connectionState: open` alone can hide, so it is
    // persisted and broadcast to the tenant.
    if (eventType === 'connection.update') {
      await this.handleConnectionUpdate(instance, payload, observedAt);
      return { accepted: true };
    }

    if (eventType === 'status.instance') {
      await this.handleStatusInstance(instance, payload, observedAt);
      return { accepted: true };
    }

    if (eventType === 'logout.instance') {
      await this.handleLogoutInstance(instance, observedAt);
      return { accepted: true };
    }

    if (eventType === 'messages.update') {
      await this.handleMessageUpdate(instance, payload);
      return { accepted: true };
    }

    if (eventType === 'messages.edited') {
      await this.handleMessageEdited(instance, payload);
      return { accepted: true };
    }

    if (eventType !== 'messages.upsert') {
      return { accepted: true, ignored: 'unsupported_event' };
    }

    const data = isRecord(payload.data) ? payload.data : null;
    if (!data) {
      return { accepted: true, ignored: 'invalid_payload' };
    }

    return this.ingestMessage(instance, data, { source: 'messages.upsert' });
  }

  private async enqueueRecovery(webhookEventId: string, error: unknown): Promise<void> {
    try {
      await this.queue.enqueue(
        JOB_NAMES.WEBHOOK_PROCESS,
        { webhookEventId },
        { jobId: webhookEventId },
      );
    } catch (enqueueError) {
      this.logger.warn(
        `Could not enqueue webhook recovery ${webhookEventId}: ${
          enqueueError instanceof Error ? enqueueError.message : 'unknown'
        }`,
      );
    }

    this.logger.warn(
      `Webhook event ${webhookEventId} left pending for retry: ${
        error instanceof Error ? error.message : 'unknown'
      }`,
    );
  }

  private async markEventProcessed(webhookEventId: string): Promise<void> {
    if (!webhookEventId) {
      return;
    }

    await this.prisma.webhookEvent.updateMany({
      where: { id: webhookEventId, processedAt: null },
      data: { processedAt: new Date() },
    });
  }

  private async handleMessagesSet(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const records = toArray(payload.data).filter(isRecord);
    const isLatest = typeof payload.isLatest === 'boolean' ? payload.isLatest : null;
    const progress = readProgress(payload.progress);

    let result: HistoryIngestResult;
    try {
      result = await this.ingestHistoryMessages(instance, records, {
        cutoff: this.historyCutoff(),
        emitRecentRealtime: true,
        source: 'messages.set',
        throwOnFailure: true,
      });
    } catch (error) {
      const failed = error instanceof HistoryIngestError ? error.result.failed : 0;
      await this.updateHistorySync(instance, {
        progress,
        failed: true,
        error: 'history_import_failed',
      });
      this.logger.warn(
        `whatsapp.history.batch.failed ${JSON.stringify({
          instance: instance.instanceName,
          received: records.length,
          failed,
          progress,
        })}`,
      );
      throw error;
    }

    const failed = result.failed > 0;
    const completed = !failed && progress === 100;
    await this.updateHistorySync(instance, {
      progress,
      completed,
      failed,
      error: failed ? 'history_import_failed' : null,
    });

    this.logger.log(
      `whatsapp.history.batch ${JSON.stringify({
        instance: instance.instanceName,
        received: result.received,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
        conversations: result.conversations,
        isLatest,
        progress,
        completed,
      })}`,
    );
  }

  /**
   * `messaging-history.set` is emitted by Evolution when its accumulated
   * history progress reaches 100. It is the definitive completion signal; the
   * per-batch `isLatest` flag is only metadata and is never used for this.
   */
  private async handleMessagingHistorySet(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const data = isRecord(payload.data) ? payload.data : null;
    const progress = readProgress(data?.progress) ?? readProgress(payload.progress);

    if (progress !== null && progress < 100) {
      await this.updateHistorySync(instance, { progress });
      return;
    }

    await this.updateHistorySync(instance, { progress: 100, completed: true });
  }

  private async updateHistorySync(
    instance: ResolvedInstance,
    update: {
      progress?: number | null;
      completed?: boolean;
      failed?: boolean;
      error?: string | null;
    },
  ): Promise<AppliedHistorySyncState | null> {
    const state = await this.instances.applyHistorySyncUpdate(instance.instanceName, update);
    if (state?.changed) {
      this.realtime.emitToTenant(instance.tenantId, 'whatsapp.history.updated', {
        instanceId: state.instanceId,
        status: state.status,
        progress: state.progress,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        error: state.error,
      });
    }
    return state;
  }

  /**
   * Imports history messages with the same idempotent pipeline used by live
   * events. Messages already stored by (tenantId, externalMessageId) are
   * skipped, so a webhook batch and a manual backfill can overlap safely.
   */
  async ingestHistoryMessages(
    instance: ResolvedInstance,
    records: unknown[],
    options: {
      cutoff: number;
      emitRecentRealtime?: boolean;
      source: string;
      throwOnFailure?: boolean;
    },
  ): Promise<HistoryIngestResult> {
    const ordered = records
      .filter(isRecord)
      .sort(
        (left, right) =>
          (readMessageTimestamp(left)?.getTime() ?? 0) -
          (readMessageTimestamp(right)?.getTime() ?? 0),
      );

    const conversations = new Set<string>();
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const record of ordered) {
      if (!isEligibleHistoryRecord(record, options.cutoff)) {
        skipped += 1;
        continue;
      }

      const occurredAt = readMessageTimestamp(record);
      const recent =
        occurredAt !== null && occurredAt.getTime() >= Date.now() - HISTORY_REALTIME_WINDOW_MS;

      try {
        const result = await this.ingestMessage(instance, record, {
          history: true,
          emitRealtime: Boolean(options.emitRecentRealtime && recent),
          source: options.source,
        });

        if (result.conversationId) {
          conversations.add(result.conversationId);
        }

        if (result.ignored) {
          skipped += 1;
        } else {
          imported += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `whatsapp.history.message.failed ${JSON.stringify({
            instance: instance.instanceName,
            source: options.source,
            messageId:
              isRecord(record.key) && typeof record.key.id === 'string' ? record.key.id : null,
            error: error instanceof Error ? error.message : 'unknown',
          })}`,
        );
      }
    }

    for (const conversationId of conversations) {
      this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
        conversationId,
      });
    }

    this.logger.log(
      `whatsapp.history.import ${JSON.stringify({
        instance: instance.instanceName,
        source: options.source,
        received: ordered.length,
        imported,
        skipped,
        failed,
        conversations: conversations.size,
      })}`,
    );

    const summary: HistoryIngestResult = {
      received: ordered.length,
      imported,
      skipped,
      failed,
      conversations: conversations.size,
    };

    if (options.throwOnFailure && failed > 0) {
      throw new HistoryIngestError(summary);
    }

    return summary;
  }

  private historyCutoff(): number {
    const days = this.config.get('WHATSAPP_HISTORY_IMPORT_DAYS') ?? 30;
    return Date.now() - days * 24 * 60 * 60 * 1000;
  }

  private async ingestMessage(
    instance: ResolvedInstance,
    data: Record<string, unknown>,
    options: { history?: boolean; emitRealtime?: boolean; source: string },
  ): Promise<WebhookIngestResult> {
    const key = isRecord(data.key) ? data.key : null;

    // Unwrap container envelopes (deviceSent/ephemeral/view-once/...) up front so
    // both edit detection and type/content extraction see the real inner message.
    // An edit sent from the user's own phone reaches the linked device wrapped in
    // a container; inspecting only `data.message` would miss it and persist a
    // bogus `[unknown]` (this was the production symptom).
    const rawMessage = data.message;
    const incomingType = readString(data.messageType);
    const { message, viewOnce } = unwrapViewOnce(rawMessage);
    const isViewOnce = viewOnce || isViewOnceMessageType(incomingType);

    // Evolution/Baileys report an edit as `messages.upsert` (protocolMessage or an
    // `editedMessage` wrapper, possibly inside a container) when its own edit
    // detection misses the envelope. Route it to the in-place update instead of
    // creating a bogus `[unknown]`. History may legitimately contain old edit
    // protocol messages; they are ignored instead of rewriting current content.
    if (!options.history) {
      const upsertEdit = parseMessageEdit(data, message);
      if (upsertEdit) {
        await this.applyMessageEdit(instance, upsertEdit);
        return { accepted: true, ignored: 'message_edited' };
      }
    }

    const fromMe = key?.fromMe === true;
    const remoteJid = readString(key?.remoteJid);
    const direction = fromMe ? MessageDirection.OUTBOUND : MessageDirection.INBOUND;

    if (!remoteJid) {
      return { accepted: true, ignored: 'missing_contact' };
    }

    // A non-edit protocol control message (revoke, ephemeral setting, app-state
    // sync, ...) is not user-visible content. Persisting it would only create a
    // bogus `[unknown]` bubble, so it is acknowledged and dropped.
    if (isRecord(message) && isRecord(message.protocolMessage)) {
      return { accepted: true, ignored: 'unsupported_message' };
    }

    // A reaction is an event about another message, never a message of its own.
    // It must be routed before contact/conversation creation and before the
    // normal message pipeline, so it cannot become a bubble, unread item or
    // conversation preview.
    const reaction = readReaction(message);
    if (reaction) {
      return this.ingestReaction(instance, data, key, remoteJid, reaction, options);
    }

    const isGroup = isGroupJid(remoteJid);
    const participant = readString(key?.participant);
    const participantAlt = readString(key?.participantAlt);
    const remoteJidAlt = readString(key?.remoteJidAlt);
    const pushName = readString(data.pushName);

    // WhatsApp migrated some accounts to LID addressing: the dialable PN may be
    // delivered silently but fail, while the LID is what actually reaches the
    // contact. The alternative fields carry it, so it is captured here and used
    // as the send destination later.
    const externalLid = isGroup
      ? null
      : (lidFromJid(remoteJid) ?? lidFromJid(participantAlt) ?? lidFromJid(remoteJidAlt));

    const contact = isGroup
      ? null
      : await this.resolveContact(
          instance.tenantId,
          resolveContactPhone(remoteJid, participantAlt, remoteJidAlt),
          pushName,
        );

    // A blocked contact never reaches the inbox: no conversation is created and
    // no message is persisted. The event is acknowledged so WhatsApp does not retry.
    // A message the user chose to send from their own phone still syncs.
    if (contact?.isBlocked && !fromMe) {
      return { accepted: true, ignored: 'blocked_contact' };
    }

    const conversation = await this.findOrCreateConversation(
      instance.tenantId,
      instance.id,
      remoteJid,
      contact?.id ?? null,
      isGroup,
      externalLid,
      !fromMe,
    );

    if (isGroup) {
      await this.ensureGroupMetadata(conversation, instance, remoteJid);
    }

    const content = extractText(message);
    const type = detectType(message);
    const audioDurationSeconds = type === MessageType.AUDIO ? readAudioDuration(message) : null;
    const linkPreview = extractWhatsAppLinkPreview(message);
    const externalMessageId = readString(key?.id);
    const quoted = await this.resolveInboundQuoted(
      instance.tenantId,
      conversation.id,
      data,
      message,
    );
    const contacts = extractContacts(message);
    const occurredAt = readMessageTimestamp(data);
    const recent =
      occurredAt !== null && occurredAt.getTime() >= Date.now() - HISTORY_REALTIME_WINDOW_MS;
    const processRecentMedia = !options.history || recent;

    const senderId = fromMe ? null : isGroup ? participant : null;
    const senderName = fromMe ? null : isGroup ? pushName : null;

    const persisted = await this.persistWebhookMessage({
      tenantId: instance.tenantId,
      whatsappInstanceId: instance.id,
      conversationId: conversation.id,
      direction,
      content,
      type,
      externalMessageId,
      senderId,
      senderName,
      occurredAt,
      history: options.history === true,
      metadata: {
        remoteJid,
        pushName,
        ...(participant ? { participantJid: participant } : {}),
        ...(isViewOnce ? { viewOnce: true } : {}),
        ...(quoted ? { quoted } : {}),
        ...(contacts ? { contacts } : {}),
        ...(linkPreview ? { linkPreview } : {}),
        ...(audioDurationSeconds !== null ? { audioDurationSeconds } : {}),
        instanceName: instance.instanceName,
        ...(options.history ? { historyImport: { source: options.source } } : {}),
      },
    });

    if (!persisted) {
      return { accepted: true, ignored: 'duplicate_message' };
    }

    // A provider event for a message the CRM already stored when it was sent
    // (same provider id) is reconciled in place: no new row and no realtime
    // event, so the open chat never shows the same message twice.
    if (!persisted.created) {
      return {
        accepted: true,
        ignored: 'reconciled_message',
        conversationId: conversation.id,
        messageId: persisted.id,
      };
    }

    // Replies may arrive before the original message (history out of order or a
    // live reply to an older message). Once the quoted message is stored, the
    // quote metadata of those replies is completed so the citation renders with
    // the correct author, type and audio duration.
    await this.backfillQuotedReplies({
      tenantId: instance.tenantId,
      conversationId: conversation.id,
      messageId: persisted.id,
      externalMessageId,
      direction,
      senderId,
      senderName,
      content,
      type,
      remoteJid,
      audioDurationSeconds,
    });

    // View-once media must never be downloaded or exposed: the UI only renders the privacy notice.
    if (isMediaType(type) && !isViewOnce && processRecentMedia) {
      await this.queue.enqueue(JOB_NAMES.MEDIA_PROCESS, {
        tenantId: instance.tenantId,
        messageId: persisted.id,
      });
    }

    // With automatic transcription enabled, the row is created immediately so
    // the chat can show "aguardando". Without it, no row is created and the
    // audio exposes a manual action. It is best-effort: a transcription
    // bookkeeping failure must never break the normal message receipt.
    if (
      type === MessageType.AUDIO &&
      direction === MessageDirection.INBOUND &&
      !isViewOnce &&
      processRecentMedia
    ) {
      try {
        if (await this.transcriptionSettings.isAutoEnabled(instance.tenantId)) {
          await this.prisma.messageTranscription.upsert({
            where: { messageId: persisted.id },
            create: {
              tenantId: instance.tenantId,
              messageId: persisted.id,
              status: 'PENDING',
            },
            update: {},
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to create transcription state for message ${persisted.id}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    if (options.emitRealtime !== false) {
      this.realtime.emitToConversation(instance.tenantId, conversation.id, 'message.created', {
        conversationId: conversation.id,
        messageId: persisted.id,
        direction,
      });
      this.realtime.emitToTenant(instance.tenantId, 'message.created', {
        conversationId: conversation.id,
        messageId: persisted.id,
        direction,
      });
      this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
        conversationId: conversation.id,
        status: conversation.status,
      });
    }

    this.logger.debug(
      `whatsapp.message.persisted ${JSON.stringify({
        instance: instance.instanceName,
        source: options.source,
        messageId: persisted.id,
        externalMessageId,
        conversationId: conversation.id,
        history: options.history === true,
      })}`,
    );

    return {
      accepted: true,
      conversationId: conversation.id,
      messageId: persisted.id,
    };
  }

  private async ingestReaction(
    instance: ResolvedInstance,
    data: Record<string, unknown>,
    key: Record<string, unknown> | null,
    remoteJid: string,
    reaction: ParsedReaction,
    options: { history?: boolean; emitRealtime?: boolean; source: string },
  ): Promise<WebhookIngestResult> {
    const targetExternalId = reaction.targetMessageId;
    if (!targetExternalId) {
      return { accepted: true, ignored: 'invalid_reaction' };
    }

    // A reaction never creates a conversation on its own. If the conversation
    // is not in the CRM there is nothing to attach the reaction to yet. The
    // lookup accepts the LID recorded on the conversation because a reaction
    // sent from the phone may arrive addressed only by the LID.
    const remoteLid = lidFromJid(remoteJid);
    const conversation =
      (await this.prisma.conversation.findFirst({
        where: {
          tenantId: instance.tenantId,
          whatsappInstanceId: instance.id,
          externalContactId: remoteJid,
        },
        select: { id: true },
      })) ??
      (remoteLid
        ? await this.prisma.conversation.findFirst({
            where: {
              tenantId: instance.tenantId,
              whatsappInstanceId: instance.id,
              isGroup: false,
              OR: [{ externalLid: remoteLid }, { externalContactId: remoteLid }],
            },
            select: { id: true },
          })
        : null);
    if (!conversation) {
      return { accepted: true, ignored: 'reaction_unknown_conversation' };
    }

    const fromMe = key?.fromMe === true;
    const isGroup = isGroupJid(remoteJid);
    const participant = readString(key?.participant) ?? readString(key?.participantAlt);
    const eventId = readString(key?.id);
    const reactorId = fromMe
      ? 'self'
      : (participant ?? (isGroup ? `unknown:${eventId ?? targetExternalId}` : remoteJid));

    const applied = await this.messages.applyReaction({
      tenantId: instance.tenantId,
      conversationId: conversation.id,
      targetExternalId,
      targetFromMe: reaction.targetFromMe,
      reactorId,
      reactorName: fromMe ? null : (readString(data.pushName) ?? null),
      fromMe,
      emoji: reaction.emoji ?? '',
      occurredAt: readMessageTimestamp(data) ?? new Date(),
    });

    if (!applied.applied) {
      return { accepted: true, ignored: 'reaction_target_conflict' };
    }

    if (applied.changed && options.emitRealtime !== false && applied.messageId) {
      this.realtime.emitToTenant(instance.tenantId, 'message.reaction', {
        conversationId: conversation.id,
        messageId: applied.messageId,
        reactions: applied.reactions,
      });
    }

    return {
      accepted: true,
      conversationId: conversation.id,
      ...(applied.messageId ? { messageId: applied.messageId } : {}),
      ...(applied.removed ? { ignored: 'reaction_removed' } : {}),
    };
  }

  private async handlePresence(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const data = isRecord(payload.data) ? payload.data : null;
    const remoteJid = readString(data?.id);
    const presences = data && isRecord(data.presences) ? data.presences : null;
    if (!remoteJid || !presences) {
      return;
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: instance.tenantId,
        whatsappInstanceId: instance.id,
        OR: [{ externalContactId: remoteJid }, { externalLid: remoteJid }],
      },
      select: {
        id: true,
        isGroup: true,
        contact: { select: { name: true } },
      },
    });
    if (!conversation) {
      return;
    }

    const receivedAt = new Date();
    const occurredAt = readEventTimestamp(payload.date_time) ?? receivedAt;
    const directory = conversation.isGroup
      ? await this.getPresenceDirectory(instance.tenantId, instance.id, conversation.id)
      : null;
    const activities: PresenceActivity[] = [];

    for (const [participantId, presence] of Object.entries(presences)) {
      if (!isRecord(presence)) {
        continue;
      }

      const rawState = readString(presence.lastKnownPresence);
      const state = rawState ? mapPresenceState(rawState) : null;
      if (!state) {
        continue;
      }

      let identity: PresenceIdentity;
      if (directory) {
        identity = resolvePresenceIdentity(directory, participantId) ?? {
          name: null,
          phone: phoneFromJid(participantId),
        };
        identity.phone ??= phoneFromJid(participantId);
      } else {
        identity = {
          name: conversation.contact?.name ?? null,
          phone: phoneFromJid(participantId),
        };
      }

      const lastSeenAt =
        state === 'offline' ? readLastSeenTimestamp(presence.lastSeen, receivedAt) : null;

      activities.push({ participantId, state, lastSeenAt, identity });
    }

    if (directory && activities.length > 0) {
      await this.fillPresenceNames(instance.tenantId, conversation.id, directory, activities);
    }

    for (const activity of activities) {
      this.realtime.emitToTenant(instance.tenantId, 'conversation.presence', {
        conversationId: conversation.id,
        participantId: activity.participantId,
        participantName: activity.identity.name,
        participantPhone: activity.identity.phone,
        state: activity.state,
        lastSeenAt: activity.lastSeenAt ? activity.lastSeenAt.toISOString() : null,
        occurredAt: occurredAt.toISOString(),
        receivedAt: receivedAt.toISOString(),
      });
    }
  }

  private async getPresenceDirectory(
    tenantId: string,
    whatsappInstanceId: string,
    conversationId: string,
  ): Promise<PresenceDirectory> {
    const cacheKey = `${tenantId}:${whatsappInstanceId}:${conversationId}`;
    const cached = this.presenceDirectories.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const participants = await this.prisma.conversationParticipant.findMany({
      where: { tenantId, conversationId, active: true },
      select: { jid: true, lid: true, phone: true, name: true },
    });
    const phones = [
      ...new Set(
        participants
          .map((participant) => participant.phone)
          .filter((phone): phone is string => phone !== null),
      ),
    ];
    const contacts =
      phones.length > 0
        ? await this.prisma.contact.findMany({
            where: { tenantId, phone: { in: phones } },
            select: { phone: true, name: true },
          })
        : [];
    const contactNameByPhone = new Map(
      contacts.flatMap((contact) =>
        contact.phone ? [[contact.phone, contact.name] as const] : [],
      ),
    );

    const directory: PresenceDirectory = {
      expiresAt: Date.now() + PRESENCE_DIRECTORY_TTL_MS,
      byJid: new Map(),
      byLid: new Map(),
      byPhone: new Map(),
      contactNames: new Map(),
      senderNames: new Map(),
    };

    for (const participant of participants) {
      const phone = participant.phone ?? phoneFromJid(participant.jid);
      const contactName = phone ? (contactNameByPhone.get(phone) ?? null) : null;
      const name =
        (contactName && contactName !== phone ? contactName : null) ?? participant.name ?? null;
      const identity: PresenceIdentity = { name, phone };
      const lid = participant.lid ?? lidFromJid(participant.jid);

      addPresenceAlias(directory.byJid, canonicalJid(participant.jid), identity);
      if (lid) {
        addPresenceAlias(directory.byLid, canonicalJid(lid), identity);
      }
      if (phone) {
        addPresenceAlias(directory.byPhone, phone, identity);
        directory.contactNames.set(phone, contactName);
      }
    }

    this.presenceDirectories.set(cacheKey, directory);
    this.trimPresenceDirectories();
    return directory;
  }

  private async fillPresenceNames(
    tenantId: string,
    conversationId: string,
    directory: PresenceDirectory,
    activities: PresenceActivity[],
  ): Promise<void> {
    const missingName = activities.filter((activity) => activity.identity.name === null);
    if (missingName.length === 0) {
      return;
    }

    const phonesToLoad = new Set<string>();
    for (const activity of missingName) {
      const phone = activity.identity.phone;
      if (phone && !directory.contactNames.has(phone)) {
        phonesToLoad.add(phone);
      }
    }
    if (phonesToLoad.size > 0) {
      const contacts = await this.prisma.contact.findMany({
        where: { tenantId, phone: { in: [...phonesToLoad] } },
        select: { phone: true, name: true },
      });
      const contactNameByPhone = new Map(
        contacts.flatMap((contact) =>
          contact.phone ? [[contact.phone, contact.name] as const] : [],
        ),
      );
      for (const phone of phonesToLoad) {
        directory.contactNames.set(phone, contactNameByPhone.get(phone) ?? null);
      }
    }

    for (const activity of missingName) {
      const phone = activity.identity.phone;
      const contactName = phone ? (directory.contactNames.get(phone) ?? null) : null;
      if (contactName && contactName !== phone) {
        activity.identity.name = contactName;
      }
    }

    const stillMissing = missingName.filter((activity) => activity.identity.name === null);
    if (stillMissing.length === 0) {
      return;
    }

    const now = Date.now();
    const senderIds = new Set<string>();
    for (const activity of stillMissing) {
      const aliases = presenceLookupAliases(activity.participantId);
      const cached = aliases
        .map((alias) => directory.senderNames.get(alias))
        .filter(
          (entry): entry is PresenceNameEntry => entry !== undefined && entry.expiresAt > now,
        );
      const cachedName = cached.find((entry) => entry.name)?.name;
      if (cachedName) {
        activity.identity.name = cachedName;
        continue;
      }
      if (cached.length === aliases.length) {
        continue;
      }
      for (const alias of aliases) {
        const entry = directory.senderNames.get(alias);
        if (!entry || entry.expiresAt <= now) {
          senderIds.add(alias);
        }
      }
    }

    const unresolved = stillMissing.filter((activity) => activity.identity.name === null);
    if (senderIds.size === 0 || unresolved.length === 0) {
      return;
    }

    const senders = await this.prisma.message.findMany({
      where: {
        tenantId,
        conversationId,
        senderId: { in: [...senderIds] },
        senderName: { not: null },
      },
      orderBy: [{ senderId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['senderId'],
      select: { senderId: true, senderName: true },
    });
    const senderNameById = new Map(
      senders.flatMap((sender) =>
        sender.senderId && sender.senderName ? [[sender.senderId, sender.senderName] as const] : [],
      ),
    );
    for (const alias of senderIds) {
      directory.senderNames.set(alias, {
        name: senderNameById.get(alias) ?? null,
        expiresAt: now + PRESENCE_NAME_TTL_MS,
      });
    }

    for (const activity of unresolved) {
      for (const alias of presenceLookupAliases(activity.participantId)) {
        const name = directory.senderNames.get(alias)?.name;
        if (name) {
          activity.identity.name = name;
          break;
        }
      }
    }
  }

  private trimPresenceDirectories(): void {
    if (this.presenceDirectories.size <= PRESENCE_DIRECTORY_CACHE_LIMIT) {
      return;
    }

    const now = Date.now();
    for (const [key, directory] of this.presenceDirectories) {
      if (directory.expiresAt <= now) {
        this.presenceDirectories.delete(key);
      }
    }
    while (this.presenceDirectories.size > PRESENCE_DIRECTORY_CACHE_LIMIT) {
      const oldest = this.presenceDirectories.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.presenceDirectories.delete(oldest);
    }
  }

  private async handleConnectionUpdate(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
    observedAt: Date,
  ): Promise<void> {
    const data = isRecord(payload.data) ? payload.data : null;
    const state = readString(data?.state) ?? readString(data?.connection);
    const statusReason = readNumber(data?.statusReason) ?? readNumber(data?.reason);

    if (!state) {
      this.logger.warn(`connection.update without state for ${instance.instanceName}`);
      return;
    }

    const result = await this.instances.applyConnectionObservation(instance.instanceName, state, {
      observedAt,
      reason: statusReason,
      source: 'webhook',
    });

    if (result) {
      this.logger.log(
        `Connection update for ${instance.instanceName}: ${state} -> ${result.status}${
          statusReason !== null ? ` (${statusReason})` : ''
        }`,
      );
    }
  }

  /**
   * `status.instance` is emitted by Evolution alongside `connection.update` on
   * non-reconnectable closes (for example when the device is removed from the
   * phone). It is a second, independent signal so a lost `connection.update`
   * does not leave the CRM reporting a connected session.
   */
  private async handleStatusInstance(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
    observedAt: Date,
  ): Promise<void> {
    const data = isRecord(payload.data) ? payload.data : null;
    const status = readString(data?.status)?.toLowerCase();
    if (status !== 'closed') {
      return;
    }

    const reason = readNumber(data?.disconnectionReasonCode);
    const reportedAt = readDate(data?.disconnectionAt);
    const disconnectedAt =
      reportedAt && Math.abs(reportedAt.getTime() - Date.now()) <= 10 * 60_000
        ? reportedAt
        : observedAt;

    const result = await this.instances.applyConnectionObservation(instance.instanceName, 'close', {
      observedAt: disconnectedAt,
      reason,
      source: 'webhook',
    });

    this.logger.log(
      `Status instance for ${instance.instanceName}: closed -> ${result?.status ?? 'unchanged'}${
        reason !== null ? ` (${reason})` : ''
      }`,
    );
  }

  /**
   * `logout.instance` has no data payload. It fires when the provider ends the
   * session (device removed or logout), so it always maps to a disconnected
   * state. The observation timestamp is the webhook receipt time.
   */
  private async handleLogoutInstance(instance: ResolvedInstance, observedAt: Date): Promise<void> {
    const result = await this.instances.applyConnectionObservation(instance.instanceName, 'close', {
      observedAt,
      reason: null,
      source: 'webhook',
    });

    this.logger.log(
      `Logout instance for ${instance.instanceName} -> ${result?.status ?? 'unchanged'}`,
    );
  }

  private async handleMessageEdited(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const entries = toArray(payload.data).filter(isRecord);

    for (const entry of entries) {
      const edit = parseMessageEdit(entry);
      if (!edit) {
        continue;
      }
      await this.applyMessageEdit(instance, edit);
    }
  }

  /**
   * Applies an edit to the stored original message. The row is matched by the
   * WhatsApp message id inside the tenant and instance, never created anew. An
   * edit that arrives before the original (or without a resolvable id) is
   * ignored safely: no message is invented and no valid content is overwritten.
   */
  private async applyMessageEdit(
    instance: ResolvedInstance,
    edit: ParsedMessageEdit,
  ): Promise<void> {
    if (edit.type === MessageType.UNKNOWN && edit.content === null) {
      this.logger.warn(
        `Ignoring message edit without usable content (instance ${instance.instanceName})`,
      );
      return;
    }

    const updated = await this.messages.applyEditByExternalId({
      tenantId: instance.tenantId,
      whatsappInstanceId: instance.id,
      externalMessageId: edit.externalMessageId,
      content: edit.content,
      type: edit.type,
    });
    if (!updated) {
      this.logger.warn(
        `Original message not found for edit ${edit.externalMessageId} (instance ${instance.instanceName}); ignoring safely`,
      );
      return;
    }

    this.realtime.emitToConversation(instance.tenantId, updated.conversationId, 'message.updated', {
      conversationId: updated.conversationId,
      messageId: updated.messageId,
    });
    this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
      conversationId: updated.conversationId,
    });
  }

  private async handleMessageUpdate(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const updates = toArray(payload.data).filter(isRecord);

    for (const update of updates) {
      // Baileys also reports edits as a `messages.update` whose `message` holds
      // the edited content; apply it in place and skip the status logic.
      const edit = parseMessageEdit(update);
      if (edit) {
        await this.applyMessageEdit(instance, edit);
        continue;
      }

      const externalMessageId = readString(update.keyId);
      const status = mapEvolutionStatus(readString(update.status));
      if (!externalMessageId || !status) {
        continue;
      }

      const updated = await this.messages.updateOutboundStatusByExternalId({
        tenantId: instance.tenantId,
        whatsappInstanceId: instance.id,
        externalMessageId,
        status,
      });
      if (!updated) {
        continue;
      }

      this.realtime.emitToConversation(
        instance.tenantId,
        updated.conversationId,
        'message.updated',
        {
          conversationId: updated.conversationId,
          messageId: updated.messageId,
          status: updated.status,
        },
      );
      this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
        conversationId: updated.conversationId,
      });

      if (updated.status === MessageStatus.FAILED) {
        await this.scheduleAddressFallback(instance, updated.messageId);
      }
    }
  }

  /**
   * A provider ERROR means the address used did not deliver. Which address a
   * WhatsApp account accepts for outbound (PN vs LID) depends on the account, so
   * the failed message is resent once to the alternate address and the
   * conversation remembers the working one for future sends. A message already
   * flagged as fallback-attempted is never retried again (no loops).
   */
  private async scheduleAddressFallback(
    instance: ResolvedInstance,
    messageId: string,
  ): Promise<void> {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId: instance.tenantId },
      select: {
        id: true,
        metadata: true,
        conversation: {
          select: {
            id: true,
            externalContactId: true,
            externalLid: true,
            preferredAddress: true,
            contact: { select: { phone: true } },
          },
        },
      },
    });
    if (!message) {
      return;
    }

    const metadata = isRecord(message.metadata) ? message.metadata : {};
    if (metadata.fallbackAttempted === true) {
      return;
    }

    const conversation = message.conversation;
    const input: DestinationInput = {
      externalContactId: conversation.externalContactId,
      externalLid: conversation.externalLid,
      contactPhone: conversation.contact?.phone ?? null,
    };
    const current = pickDestination(input, conversation.preferredAddress);
    if (!current || current.type === 'GROUP') {
      return;
    }
    const alternate = alternateDestination(input, current.type);
    if (!alternate) {
      return;
    }

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { preferredAddress: alternate.type },
    });
    await this.messages.markFallbackAttempted(messageId);

    this.logger.log(
      `Falling back outbound ${messageId} from ${current.type} to ${alternate.type} (instance ${instance.instanceName})`,
    );

    await this.queue.enqueue(JOB_NAMES.WHATSAPP_SEND, {
      tenantId: instance.tenantId,
      messageId,
      fallback: true,
    });
  }

  /**
   * Atomically claims an event for processing. A duplicate is only ignored when
   * its previous delivery was fully processed (`processedAt` set). An event that
   * was claimed but never completed is retried, so a database/processing failure
   * cannot silently discard it.
   */
  private async recordEvent(input: {
    tenantId: string;
    externalEventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<{ id: string; duplicate: boolean }> {
    try {
      const created = await this.prisma.webhookEvent.create({
        data: {
          tenantId: input.tenantId,
          provider: 'evolution',
          externalEventId: input.externalEventId,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return { id: created.id, duplicate: false };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }

      const existing = await this.prisma.webhookEvent.findFirst({
        where: {
          provider: 'evolution',
          externalEventId: input.externalEventId,
        },
        select: { id: true, processedAt: true },
      });
      if (!existing) {
        throw error;
      }

      return { id: existing.id, duplicate: existing.processedAt !== null };
    }
  }

  private async findOrCreateConversation(
    tenantId: string,
    whatsappInstanceId: string,
    externalContactId: string,
    contactId: string | null,
    isGroup: boolean,
    externalLid: string | null,
    reopenClosed = true,
  ): Promise<ConversationIdentity> {
    const identity = {
      tenantId,
      whatsappInstanceId,
      externalContactId,
      contactId,
      isGroup,
      externalLid,
    };
    const existing = await this.findConversationByIdentity(identity);
    if (existing) {
      return this.applyConversationIdentity(existing, identity, reopenClosed);
    }

    try {
      return await this.prisma.conversation.create({
        data: {
          tenantId,
          whatsappInstanceId,
          externalContactId,
          externalLid: isGroup ? null : externalLid,
          contactId,
          isGroup,
          status: ConversationStatus.OPEN,
        },
        select: CONVERSATION_IDENTITY_SELECT,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }

      // A concurrent event created the same conversation between the lookup and
      // the insert. Rereading includes the LID/contact aliases, so the losing
      // event reuses the winner instead of failing the webhook.
      const raced = await this.findConversationByIdentity(identity);
      if (!raced) {
        throw error;
      }
      return this.applyConversationIdentity(raced, identity, reopenClosed);
    }
  }

  /**
   * Resolves a 1:1 conversation by every identity the provider has already
   * proven for this chat, in order of strength: the exact remote JID, the LID
   * recorded on a previous event (Evolution swaps `remoteJid`/`remoteJidAlt`
   * for LID-addressed inbound chats), a conversation created while only the LID
   * was known, and finally the contact's single conversation in the instance.
   * A LID is never converted into a phone: without a recorded association the
   * message keeps its own LID conversation.
   */
  private async findConversationByIdentity(input: {
    tenantId: string;
    whatsappInstanceId: string;
    externalContactId: string;
    contactId: string | null;
    isGroup: boolean;
    externalLid: string | null;
  }): Promise<ConversationIdentity | null> {
    const scope = {
      tenantId: input.tenantId,
      whatsappInstanceId: input.whatsappInstanceId,
    };
    const exact = await this.prisma.conversation.findFirst({
      where: { ...scope, externalContactId: input.externalContactId },
      select: CONVERSATION_IDENTITY_SELECT,
    });
    if (exact || input.isGroup) {
      return exact;
    }

    const lid = input.externalLid;
    if (lid) {
      const byRecordedLid = await this.prisma.conversation.findFirst({
        where: { ...scope, isGroup: false, externalLid: lid },
        orderBy: { createdAt: 'asc' },
        select: CONVERSATION_IDENTITY_SELECT,
      });
      if (byRecordedLid) {
        return byRecordedLid;
      }

      if (lid !== input.externalContactId) {
        const byLidKey = await this.prisma.conversation.findFirst({
          where: { ...scope, isGroup: false, externalContactId: lid },
          select: CONVERSATION_IDENTITY_SELECT,
        });
        if (byLidKey) {
          return byLidKey;
        }
      }
    }

    if (!input.contactId) {
      return null;
    }

    const byContact = await this.prisma.conversation.findMany({
      where: { ...scope, isGroup: false, contactId: input.contactId },
      orderBy: { createdAt: 'asc' },
      take: 2,
      select: CONVERSATION_IDENTITY_SELECT,
    });
    // More than one conversation for the same contact means earlier duplicate
    // data; picking one would split the history, so creation is left to the
    // caller and the data issue is handled separately.
    return byContact.length === 1 ? byContact[0] : null;
  }

  private async applyConversationIdentity(
    existing: ConversationIdentity,
    input: {
      contactId: string | null;
      isGroup: boolean;
      externalLid: string | null;
    },
    reopenClosed: boolean,
  ): Promise<ConversationIdentity> {
    const data: Prisma.ConversationUncheckedUpdateInput = {};
    if (reopenClosed && existing.status === ConversationStatus.CLOSED) {
      data.status = ConversationStatus.OPEN;
      data.closedAt = null;
    }
    if (!input.isGroup && !existing.contactId && input.contactId) {
      data.contactId = input.contactId;
    }
    if (!input.isGroup && input.externalLid && existing.externalLid !== input.externalLid) {
      data.externalLid = input.externalLid;
    }
    if (input.isGroup && !existing.isGroup) {
      data.isGroup = true;
    }

    if (Object.keys(data).length === 0) {
      return existing;
    }

    return this.prisma.conversation.update({
      where: { id: existing.id },
      data,
      select: CONVERSATION_IDENTITY_SELECT,
    });
  }

  private async resolveContact(tenantId: string, phone: string | null, name: string | null) {
    if (!phone) {
      return null;
    }
    return this.contacts.findOrCreateByPhone({ tenantId, phone, name });
  }

  private async ensureGroupMetadata(
    conversation: { id: string; groupName: string | null },
    instance: ResolvedInstance,
    groupJid: string,
  ): Promise<void> {
    if (conversation.groupName) {
      return;
    }

    const info = await this.directory.resolveGroupInfo(instance.instanceName, groupJid);
    if (!info) {
      return;
    }

    const data: Prisma.ConversationUpdateInput = {};
    if (info.name) data.groupName = info.name;
    if (info.avatarUrl) data.avatarUrl = info.avatarUrl;
    if (Object.keys(data).length === 0) {
      return;
    }

    await this.prisma.conversation.update({ where: { id: conversation.id }, data });
    this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
      conversationId: conversation.id,
    });
  }

  private async handleGroupUpsert(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
    replaceParticipants: boolean,
  ): Promise<void> {
    const groups = toArray(payload.data).filter(isRecord);

    for (const group of groups) {
      await this.conversationSync.syncGroup(instance, group, { replaceParticipants });
    }
  }

  private async handleGroupParticipantsUpdate(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.conversationSync.syncGroupParticipants(instance, payload.data);
  }

  private async handleContactSync(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Evolution may send a single object (contact discovered from a message) or
    // an array (address-book upsert). Both shapes are normalized here.
    const entries = toArray(payload.data).filter(isRecord);

    for (const entry of entries) {
      const jid = readString(entry.remoteJid) ?? readString(entry.id) ?? readString(entry.jid);
      if (!jid) {
        continue;
      }

      await this.contacts.syncFromWhatsAppEvent({
        tenantId: instance.tenantId,
        jid,
        name:
          readString(entry.pushName) ?? readString(entry.name) ?? readString(entry.verifiedName),
        avatarUrl:
          readString(entry.profilePicUrl) ??
          readString(entry.profilePictureUrl) ??
          readString(entry.avatarUrl),
      });
    }
  }

  private async handleChatSync(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const chats = toArray(payload.data).filter(isRecord);
    for (const chat of chats) {
      await this.conversationSync.syncChat(instance, chat);
    }
  }

  /**
   * Persists a WhatsApp message with idempotency on `(tenantId, externalMessageId)`.
   * A provider event for a message already stored by the CRM send (same id) is
   * reconciled in place and flagged as not created, so no duplicate row or
   * realtime event is produced. Distinct messages with equal content are kept.
   */
  private async persistWebhookMessage(input: {
    tenantId: string;
    whatsappInstanceId: string;
    conversationId: string;
    direction: MessageDirection;
    content: string | null;
    type: MessageType;
    externalMessageId: string | null;
    senderId: string | null;
    senderName: string | null;
    occurredAt: Date | null;
    history?: boolean;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string; created: boolean } | null> {
    const occurredAt = input.occurredAt ?? new Date();

    if (input.direction === MessageDirection.OUTBOUND && input.externalMessageId) {
      const existing = await this.prisma.message.findFirst({
        where: {
          tenantId: input.tenantId,
          externalMessageId: input.externalMessageId,
          conversation: { whatsappInstanceId: input.whatsappInstanceId },
        },
        select: { id: true, direction: true, metadata: true },
      });
      if (existing) {
        if (existing.direction === MessageDirection.OUTBOUND) {
          const merged = {
            ...(isRecord(existing.metadata) ? existing.metadata : {}),
            ...input.metadata,
          };
          await this.prisma.message.update({
            where: { id: existing.id },
            data: { metadata: merged as Prisma.InputJsonValue },
          });
        }
        return { id: existing.id, created: false };
      }
    }

    try {
      const message = await this.prisma.message.create({
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          direction: input.direction,
          type: input.type,
          content: input.content,
          externalMessageId: input.externalMessageId,
          status:
            input.direction === MessageDirection.OUTBOUND
              ? MessageStatus.SENT
              : MessageStatus.RECEIVED,
          senderId: input.senderId,
          senderName: input.senderName,
          metadata: input.metadata as Prisma.InputJsonValue,
          occurredAt,
        },
        select: { id: true },
      });

      // A new inbound message returns an archived conversation to the inbox;
      // an outbound one (sent by the user from their phone) must not. Historical
      // messages only move `lastMessageAt` forward, so importing old history
      // does not bump active conversations to the top of the inbox.
      const conversationData = {
        lastMessageAt: occurredAt,
        ...(input.direction === MessageDirection.INBOUND ? { isArchived: false } : {}),
      };

      if (input.history) {
        await this.prisma.conversation.updateMany({
          where: {
            id: input.conversationId,
            OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: occurredAt } }],
          },
          data: conversationData,
        });
      } else {
        await this.prisma.conversation.update({
          where: { id: input.conversationId },
          data: conversationData,
        });
      }

      return { id: message.id, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A concurrent event (or the CRM send itself) stored the same provider id.
        const raced = await this.prisma.message.findFirst({
          where: {
            tenantId: input.tenantId,
            externalMessageId: input.externalMessageId,
            conversation: { whatsappInstanceId: input.whatsappInstanceId },
          },
          select: { id: true },
        });
        return raced ? { id: raced.id, created: false } : null;
      }
      throw error;
    }
  }

  /**
   * Completes the quote metadata of replies that were persisted before their
   * quoted message. Matching is done strictly by the external id inside the
   * same conversation; content/time/sender are never used, so a reply can never
   * be linked to an unrelated message.
   */
  private async backfillQuotedReplies(input: {
    tenantId: string;
    conversationId: string;
    messageId: string;
    externalMessageId: string | null;
    direction: MessageDirection;
    senderId: string | null;
    senderName: string | null;
    content: string | null;
    type: MessageType;
    remoteJid: string;
    audioDurationSeconds: number | null;
  }): Promise<void> {
    if (!input.externalMessageId) {
      return;
    }

    const replies = await this.prisma.message.findMany({
      where: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        id: { not: input.messageId },
        metadata: {
          path: ['quoted', 'externalId'],
          equals: input.externalMessageId,
        },
      },
      select: { id: true, metadata: true },
      take: 100,
    });

    for (const reply of replies) {
      const metadata = isRecord(reply.metadata) ? reply.metadata : {};
      const quoted = isRecord(metadata.quoted) ? metadata.quoted : null;
      if (!quoted) {
        continue;
      }

      const existingType =
        typeof quoted.type === 'string' ? (quoted.type as MessageType) : MessageType.UNKNOWN;
      const type = input.type === MessageType.UNKNOWN ? existingType : input.type;
      const nextQuoted: QuotedMessageInfo = {
        messageId: input.messageId,
        externalId: input.externalMessageId,
        remoteJid: readString(quoted.remoteJid) ?? input.remoteJid,
        authorName: input.senderName ?? readString(quoted.authorName),
        authorJid: readString(quoted.authorJid) ?? input.senderId,
        fromMe: input.direction === MessageDirection.OUTBOUND,
        content: input.content ?? readString(quoted.content),
        type,
        audioDurationSeconds:
          type === MessageType.AUDIO
            ? (input.audioDurationSeconds ?? readAudioDurationFromMetadata(quoted))
            : null,
      };
      const nextMetadata = { ...metadata, quoted: nextQuoted };
      if (JSON.stringify(nextMetadata) === JSON.stringify(metadata)) {
        continue;
      }

      await this.prisma.message.update({
        where: { id: reply.id },
        data: { metadata: nextMetadata as unknown as Prisma.InputJsonValue },
      });
      this.realtime.emitToConversation(input.tenantId, input.conversationId, 'message.updated', {
        conversationId: input.conversationId,
        messageId: reply.id,
      });
      this.realtime.emitToTenant(input.tenantId, 'conversation.updated', {
        conversationId: input.conversationId,
      });
    }
  }

  /**
   * Extracts the quoted message context of a reply, enriching it from the local
   * history. Evolution 2.4 flattens an inbound text reply into `conversation`
   * and drops the `extendedTextMessage` wrapper; the quote context then arrives
   * at the root of the event (`data.contextInfo`) instead of inside the message
   * body. Both shapes are accepted here.
   */
  private async resolveInboundQuoted(
    tenantId: string,
    conversationId: string,
    data: Record<string, unknown> | null,
    message: unknown,
  ): Promise<QuotedMessageInfo | null> {
    const contextInfo = findReplyContextInfo(data, message);
    if (!contextInfo) {
      return null;
    }

    // `contextInfo` is also used for mentions, ephemeral settings, status
    // attributions and other technical metadata. Only `stanzaId` identifies an
    // explicit reply; without it there is no message to quote, even when
    // `quotedMessage` or other fields are present.
    const externalId = readString(contextInfo.stanzaId);
    if (!externalId) {
      return null;
    }

    const remoteJid = readString(contextInfo.remoteJid) ?? readString(contextInfo.remoteJidAlt);
    const authorJid = readString(contextInfo.participant) ?? readString(contextInfo.participantAlt);
    const quotedRaw = contextInfo.quotedMessage;
    let content = extractText(quotedRaw);
    let type = detectType(quotedRaw);
    let audioDurationSeconds = type === MessageType.AUDIO ? readAudioDuration(quotedRaw) : null;
    let authorName: string | null = null;
    let fromMe = false;
    let messageId: string | null = null;

    // The quoted message must belong to the same conversation, which already
    // scopes the lookup by tenant and instance. The external id alone is used
    // for the match: text, time or sender name are never considered, since two
    // distinct messages can share them.
    const local = await this.prisma.message.findFirst({
      where: { tenantId, conversationId, externalMessageId: externalId },
      select: {
        id: true,
        direction: true,
        senderId: true,
        senderName: true,
        content: true,
        type: true,
        metadata: true,
      },
    });

    if (local) {
      messageId = local.id;
      fromMe = local.direction === MessageDirection.OUTBOUND;
      authorName = local.senderName;
      content = local.content ?? content;
      type = local.type;
      if (type === MessageType.AUDIO) {
        audioDurationSeconds =
          readAudioDurationFromMetadata(local.metadata) ?? audioDurationSeconds;
      }
    }

    if (!authorName && authorJid) {
      authorName = await this.resolveQuotedAuthorName(tenantId, conversationId, authorJid);
    }

    return {
      messageId,
      externalId,
      remoteJid,
      authorName,
      authorJid,
      fromMe,
      content,
      type,
      audioDurationSeconds,
    };
  }

  /**
   * Resolves the quoted author display name when the original message is not
   * stored locally. Group participants are addressed by LID in newer WhatsApp
   * accounts, so jid, lid, and phone are all tried before falling back to the
   * CRM contact.
   */
  private async resolveQuotedAuthorName(
    tenantId: string,
    conversationId: string,
    authorJid: string,
  ): Promise<string | null> {
    const canonical = canonicalJid(authorJid);
    const phone = phoneFromJid(authorJid);
    const aliases = [...new Set([authorJid, canonical])];

    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        tenantId,
        conversationId,
        OR: [{ jid: { in: aliases } }, { lid: { in: aliases } }, ...(phone ? [{ phone }] : [])],
      },
      select: { name: true },
    });
    const participantName = participant?.name?.trim();
    if (participantName) {
      return participantName;
    }

    if (!phone) {
      return null;
    }
    const contact = await this.prisma.contact.findFirst({
      where: { tenantId, phone },
      select: { name: true },
    });
    return contact?.name?.trim() || null;
  }
}

function isEligibleHistoryRecord(record: Record<string, unknown>, cutoff: number): boolean {
  const key = isRecord(record.key) ? record.key : null;
  const messageId = key ? readString(key.id) : null;
  const remoteJid = key ? readString(key.remoteJid) : null;
  if (!messageId || !remoteJid || !isRecord(record.message)) {
    return false;
  }

  if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) {
    return false;
  }

  const occurredAt = readMessageTimestamp(record);
  return occurredAt !== null && occurredAt.getTime() >= cutoff;
}

function computeEventId(
  payload: Record<string, unknown>,
  eventType: string,
  instanceName: string,
): string {
  const data = isRecord(payload.data) ? payload.data : null;
  const key = data && isRecord(data.key) ? data.key : null;
  const messageId = readString(key?.id);
  if (messageId) {
    // Editing the same message twice must not collapse into a single event, so
    // the edited content is part of the identity while exact retries still match.
    const suffix =
      eventType === 'messages.edited' ? `:${contentFingerprint(data?.editedMessage)}` : '';
    return `${instanceName}:${eventType}:${messageId}${suffix}`;
  }

  const updateId = data ? readString(data.keyId) : null;
  if (updateId) {
    const status = readString(data?.status);
    const suffix = data && isRecord(data.message) ? `:${contentFingerprint(data.message)}` : '';
    return `${instanceName}:${eventType}:${updateId}${status ? `:${status}` : ''}${suffix}`;
  }

  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 40);
  return `${instanceName}:${eventType}:${hash}`;
}

function contentFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')
    .slice(0, 16);
}

function mapEvolutionStatus(value: string | null): MessageStatus | null {
  switch (value) {
    case 'PENDING':
      return MessageStatus.PENDING;
    case 'SERVER_ACK':
      return MessageStatus.SENT;
    case 'DELIVERY_ACK':
      return MessageStatus.DELIVERED;
    case 'READ':
    case 'PLAYED':
      return MessageStatus.READ;
    case 'ERROR':
      return MessageStatus.FAILED;
    default:
      return null;
  }
}

export function readInstanceName(payload: Record<string, unknown>): string | null {
  const direct = readString(payload.instance) ?? readString(payload.instanceName);
  if (direct) {
    return direct;
  }
  const data = isRecord(payload.data) ? payload.data : null;
  return data ? readString(data.instance) : null;
}

const VIEW_ONCE_KEYS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
const MESSAGE_CONTAINER_KEYS = [
  'ephemeralMessage',
  'deviceSentMessage',
  'documentWithCaptionMessage',
];

/** Evolution reports the wire message type; it is a reliable view-once hint. */
function isViewOnceMessageType(messageType: string | null): boolean {
  return messageType !== null && VIEW_ONCE_KEYS.includes(messageType);
}

/**
 * Unwraps view-once and other container envelopes (ephemeral, device-sent,
 * document-with-caption) so the inner type and caption are preserved. The
 * view-once flag is returned whenever a view-once wrapper is present, even if
 * the inner content is absent from the event (WhatsApp withholds it).
 */
function unwrapViewOnce(value: unknown): { message: unknown; viewOnce: boolean } {
  let current: unknown = value;
  let viewOnce = false;
  const maxDepth = VIEW_ONCE_KEYS.length + MESSAGE_CONTAINER_KEYS.length;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (!isRecord(current)) {
      break;
    }
    const record = current;

    const viewOnceKey = VIEW_ONCE_KEYS.find((key) => key in record);
    if (viewOnceKey) {
      viewOnce = true;
      const wrapper = record[viewOnceKey];
      if (isRecord(wrapper) && isRecord(wrapper.message)) {
        current = wrapper.message;
        continue;
      }
      break;
    }

    const containerKey = MESSAGE_CONTAINER_KEYS.find((key) => {
      const wrapper = record[key];
      return isRecord(wrapper) && isRecord(wrapper.message);
    });
    if (containerKey) {
      const wrapper = record[containerKey];
      current = isRecord(wrapper) ? wrapper.message : current;
      continue;
    }

    break;
  }

  return { message: current, viewOnce };
}

interface ParsedReaction {
  emoji: string | null;
  targetMessageId: string | null;
  targetFromMe: boolean;
}

/**
 * Reads an Evolution `reactionMessage`. The reactor is identified by the outer
 * message key; this payload only carries the reacted message and the emoji.
 */
function readReaction(message: unknown): ParsedReaction | null {
  if (!isRecord(message)) {
    return null;
  }
  const reaction = isRecord(message.reactionMessage) ? message.reactionMessage : null;
  if (!reaction) {
    return null;
  }
  const key = isRecord(reaction.key) ? reaction.key : null;
  return {
    emoji: readString(reaction.text),
    targetMessageId: key ? readString(key.id) : null,
    targetFromMe: key?.fromMe === true,
  };
}

interface ParsedMessageEdit {
  externalMessageId: string;
  content: string | null;
  type: MessageType;
}

const MESSAGE_EDIT_PROTOCOL_TYPE = 14;

/**
 * Recognizes the shapes Evolution/Baileys use to report a message edit:
 *  - `messages.edited`: `data` is the edit protocolMessage (`key` + `editedMessage`);
 *  - `messages.upsert`: `data.message.protocolMessage` (same protocolMessage shape),
 *    also when `data.message` is a container envelope (deviceSent/ephemeral/...);
 *  - `messages.update`: `data.keyId` plus `data.message.editedMessage.message`;
 *  - a future-proof `data.message.editedMessage.message` wrapper (target `data.key.id`).
 * Returns null for anything that is not an edit, so status receipts, reactions
 * and regular messages keep their normal flow.
 */
function parseMessageEdit(
  entry: Record<string, unknown>,
  unwrappedMessage?: unknown,
): ParsedMessageEdit | null {
  const direct = readProtocolEdit(entry);
  if (direct) {
    return fromProtocolEdit(direct, entry);
  }

  const message = isRecord(entry.message) ? entry.message : null;
  if (!message) {
    return null;
  }

  // Check the container-unwrapped message first (deviceSent/ephemeral edits sent
  // from a linked phone), then the raw one.
  const candidates: Record<string, unknown>[] = [];
  if (isRecord(unwrappedMessage)) {
    candidates.push(unwrappedMessage);
  }
  candidates.push(message);

  for (const candidate of candidates) {
    const directProtocol = readProtocolEdit(candidate.protocolMessage);
    if (directProtocol) {
      return fromProtocolEdit(directProtocol, entry);
    }

    const edited = isRecord(candidate.editedMessage) ? candidate.editedMessage : null;
    if (!edited) {
      continue;
    }

    const inner = isRecord(edited.message) ? edited.message : null;
    const nestedProtocol = inner ? readProtocolEdit(inner.protocolMessage) : null;
    if (nestedProtocol) {
      return fromProtocolEdit(nestedProtocol, entry);
    }

    const externalMessageId =
      readString(entry.keyId) ?? (isRecord(entry.key) ? readString(entry.key.id) : null);
    if (!externalMessageId) {
      return null;
    }
    return buildMessageEdit(externalMessageId, inner ?? edited);
  }

  return null;
}

function readProtocolEdit(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type !== MESSAGE_EDIT_PROTOCOL_TYPE && !isRecord(value.editedMessage)) {
    return null;
  }
  return value;
}

function fromProtocolEdit(
  protocol: Record<string, unknown>,
  entry: Record<string, unknown>,
): ParsedMessageEdit | null {
  const key = isRecord(protocol.key) ? protocol.key : null;
  const entryKey = isRecord(entry.key) ? entry.key : null;
  const externalMessageId =
    (key ? readString(key.id) : null) ??
    readString(entry.keyId) ??
    (entryKey ? readString(entryKey.id) : null);
  const edited = isRecord(protocol.editedMessage) ? protocol.editedMessage : null;
  if (!externalMessageId || !edited) {
    return null;
  }
  return buildMessageEdit(externalMessageId, edited);
}

const REDACTED_KEYS = new Set([
  'token',
  'apikey',
  'api_key',
  'authorization',
  'password',
  'secret',
  'webhooksecret',
  'webhook_secret',
  'base64',
  'qrcode',
  'qr',
  'pairingcode',
  'pairing_code',
]);

/**
 * Produces a log-safe copy of a webhook payload: credentials are masked and long
 * strings (message bodies) are truncated. Only used behind `WEBHOOK_DEBUG_PAYLOAD`.
 */
function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return '[deep]';
  }
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPayload(item, depth + 1));
  }
  if (!isRecord(value)) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      output[key] = '[redacted]';
    } else {
      output[key] = redactPayload(item, depth + 1);
    }
  }
  return output;
}

function buildMessageEdit(externalMessageId: string, content: unknown): ParsedMessageEdit {
  return {
    externalMessageId,
    content: extractText(content),
    type: detectType(content),
  };
}

/**
 * Individual conversations may be addressed by a LID (`<id>@lid`) without a
 * dialable phone. Evolution also sends the phone in the alternative fields.
 */
function resolveContactPhone(
  remoteJid: string,
  participantAlt: string | null,
  remoteJidAlt: string | null,
): string | null {
  return (
    phoneFromJid(remoteJid) ??
    (participantAlt ? phoneFromJid(participantAlt) : null) ??
    (remoteJidAlt ? phoneFromJid(remoteJidAlt) : null)
  );
}

const CONTEXT_MESSAGE_PARTS = [
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'locationMessage',
  'contactMessage',
] as const;

/**
 * Finds the context that carries an explicit reply (`stanzaId`). Evolution
 * versions differ in where they keep it: inside the message part for media and
 * older builds, or at the event root after flattening a text reply into
 * `conversation`. Candidates without a `stanzaId` are technical metadata
 * (mentions, ephemeral settings, threads) and never identify a reply.
 */
function findReplyContextInfo(
  data: Record<string, unknown> | null,
  message: unknown,
): Record<string, unknown> | null {
  const candidates: unknown[] = [];

  if (isRecord(message)) {
    for (const part of CONTEXT_MESSAGE_PARTS) {
      const node = message[part];
      if (isRecord(node)) {
        candidates.push(node.contextInfo);
      }
    }
    candidates.push(message.contextInfo);
    candidates.push(message.messageContextInfo);
  }

  if (data) {
    candidates.push(data.contextInfo);
    const dataMessage = isRecord(data.message) ? data.message : null;
    if (dataMessage) {
      candidates.push(dataMessage.contextInfo);
      candidates.push(dataMessage.messageContextInfo);
    }
  }

  for (const candidate of candidates) {
    if (isRecord(candidate) && readString(candidate.stanzaId)) {
      return candidate;
    }
  }
  return null;
}

function extractText(message: unknown): string | null {
  if (!isRecord(message)) {
    return null;
  }
  const conversation = message.conversation;
  if (typeof conversation === 'string' && conversation.trim().length > 0) {
    return conversation;
  }
  const extended = isRecord(message.extendedTextMessage) ? message.extendedTextMessage : null;
  if (extended && typeof extended.text === 'string') {
    return extended.text;
  }
  const image = isRecord(message.imageMessage) ? message.imageMessage : null;
  if (image && typeof image.caption === 'string') {
    return image.caption;
  }
  const video = isRecord(message.videoMessage) ? message.videoMessage : null;
  if (video && typeof video.caption === 'string') {
    return video.caption;
  }
  const contact = isRecord(message.contactMessage) ? message.contactMessage : null;
  if (contact && typeof contact.displayName === 'string' && contact.displayName.trim().length > 0) {
    return contact.displayName;
  }
  const contactsArray = isRecord(message.contactsArrayMessage)
    ? message.contactsArrayMessage
    : null;
  if (
    contactsArray &&
    typeof contactsArray.displayName === 'string' &&
    contactsArray.displayName.trim().length > 0
  ) {
    return contactsArray.displayName;
  }
  return null;
}

function detectType(message: unknown): MessageType {
  if (!isRecord(message)) {
    return MessageType.UNKNOWN;
  }
  if (message.conversation !== undefined || message.extendedTextMessage !== undefined) {
    return MessageType.TEXT;
  }
  if (message.imageMessage !== undefined) return MessageType.IMAGE;
  if (message.audioMessage !== undefined) return MessageType.AUDIO;
  if (message.videoMessage !== undefined) return MessageType.VIDEO;
  if (message.documentMessage !== undefined) return MessageType.DOCUMENT;
  if (message.stickerMessage !== undefined) return MessageType.STICKER;
  if (message.locationMessage !== undefined) return MessageType.LOCATION;
  if (message.contactMessage !== undefined || message.contactsArrayMessage !== undefined)
    return MessageType.CONTACT;
  return MessageType.UNKNOWN;
}

export function extractWhatsAppLinkPreview(message: unknown): LinkPreviewMetadata | null {
  if (!isRecord(message)) {
    return null;
  }

  const extended = isRecord(message.extendedTextMessage) ? message.extendedTextMessage : null;
  if (!extended) {
    return null;
  }

  const text = readString(extended.text);
  const direct = buildLinkPreview({
    rawUrl: readString(extended.canonicalUrl) ?? readString(extended.matchedText),
    text,
    title: readString(extended.title),
    description: readString(extended.description),
    imageUrl: readString(extended.thumbnailUrl),
    thumbnail: readString(extended.jpegThumbnail),
  });
  if (direct) {
    return direct;
  }

  const contextInfo = isRecord(extended.contextInfo) ? extended.contextInfo : null;
  const adReply =
    contextInfo && isRecord(contextInfo.externalAdReply) ? contextInfo.externalAdReply : null;
  if (!adReply) {
    return null;
  }

  return buildLinkPreview({
    rawUrl:
      readString(adReply.sourceUrl) ??
      readString(adReply.mediaUrl) ??
      readString(adReply.canonicalUrl),
    text,
    title: readString(adReply.title),
    description: readString(adReply.body) ?? readString(adReply.description),
    imageUrl: readString(adReply.thumbnailUrl),
    thumbnail: readString(adReply.jpegThumbnail),
  });
}

function buildLinkPreview(input: {
  rawUrl: string | null;
  text: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  thumbnail: string | null;
}): LinkPreviewMetadata | null {
  const url =
    (input.rawUrl ? normalizePreviewUrl(input.rawUrl) : null) ??
    extractPreviewUrlsFromText(input.text)[0] ??
    null;
  if (!url) {
    return null;
  }

  const title = sanitizePreviewText(input.title, MAX_PREVIEW_TITLE_LENGTH);
  const description = sanitizePreviewText(input.description, MAX_PREVIEW_DESCRIPTION_LENGTH);
  const imageUrl = input.imageUrl
    ? normalizePreviewUrl(input.imageUrl)
    : thumbnailDataUrl(input.thumbnail);
  const siteName = null;

  if (!title && !description && !imageUrl) {
    return null;
  }

  return {
    url,
    title,
    description,
    imageUrl,
    siteName,
    domain: previewDomain(url),
  };
}

function thumbnailDataUrl(value: string | null): string | null {
  if (!value || value.length > 100_000) {
    return null;
  }
  const payload = value.includes('base64,') ? value.slice(value.indexOf('base64,') + 7) : value;
  if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(payload)) {
    return null;
  }
  return `data:image/jpeg;base64,${payload.replace(/\s/g, '')}`;
}

function isMediaType(type: MessageType): boolean {
  return (
    type === MessageType.IMAGE ||
    type === MessageType.AUDIO ||
    type === MessageType.VIDEO ||
    type === MessageType.DOCUMENT ||
    type === MessageType.STICKER
  );
}

const EVENT_TYPE_ALIASES: Record<string, string> = {
  MESSAGES_SET: 'messages.set',
  MESSAGES_UPSERT: 'messages.upsert',
  MESSAGES_UPDATE: 'messages.update',
  MESSAGES_EDITED: 'messages.edited',
  MESSAGING_HISTORY_SET: 'messaging-history.set',
  CONTACTS_SET: 'contacts.set',
  CONTACTS_UPSERT: 'contacts.upsert',
  CONTACTS_UPDATE: 'contacts.update',
  CHATS_SET: 'chats.set',
  CHATS_UPSERT: 'chats.upsert',
  CHATS_UPDATE: 'chats.update',
  GROUPS_UPSERT: 'groups.upsert',
  GROUPS_UPDATE: 'groups.update',
  GROUP_UPDATE: 'groups.update',
  GROUP_PARTICIPANTS_UPDATE: 'group-participants.update',
  PRESENCE_UPDATE: 'presence.update',
  CONNECTION_UPDATE: 'connection.update',
  QRCODE_UPDATED: 'qrcode.updated',
  STATUS_INSTANCE: 'status.instance',
  LOGOUT_INSTANCE: 'logout.instance',
};

function normalizeEventType(value: string): string {
  return EVENT_TYPE_ALIASES[value.toUpperCase()] ?? value.toLowerCase();
}

function readProgress(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return null;
  }

  return Math.round(numeric);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function readDate(value: unknown): Date | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Evolution reports `messageTimestamp` in seconds. It is used only to order
 * messages sent from the phone/Web; unknown or invalid values fall back to the
 * persistence instant.
 */
function readAudioDuration(message: unknown): number | null {
  if (!isRecord(message)) {
    return null;
  }
  const audio = isRecord(message.audioMessage) ? message.audioMessage : null;
  const raw = audio?.seconds;
  const seconds =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.length > 0
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function readAudioDurationFromMetadata(metadata: unknown): number | null {
  if (!isRecord(metadata)) {
    return null;
  }
  const raw = metadata.audioDurationSeconds;
  const seconds =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.length > 0
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function readMessageTimestamp(data: Record<string, unknown> | null): Date | null {
  const raw = data?.messageTimestamp;
  const seconds =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.length > 0
        ? Number(raw)
        : Number.NaN;

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const millis = seconds > 1e12 ? seconds : seconds * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

type PresenceState = 'online' | 'offline' | 'composing' | 'recording';

/**
 * Evolution/Baileys uses `available`/`unavailable` for online state and
 * `composing`/`recording` for transient activity. `paused` (typing stopped) is
 * normalized to the online state so the activity indicator is cleared without
 * confusing it with an offline contact.
 */
function mapPresenceState(state: string): PresenceState | null {
  switch (state) {
    case 'available':
    case 'paused':
      return 'online';
    case 'unavailable':
      return 'offline';
    case 'composing':
      return 'composing';
    case 'recording':
      return 'recording';
    default:
      return null;
  }
}

/**
 * WhatsApp device suffixes (`:NN`) identify a device, not a different person.
 * Removing them keeps the same identity comparable across presence and metadata.
 */
function canonicalJid(jid: string): string {
  const separatorIndex = jid.indexOf('@');
  if (separatorIndex <= 0) {
    return jid;
  }
  const localPart = jid.slice(0, separatorIndex).split(':')[0];
  return `${localPart}@${jid.slice(separatorIndex + 1)}`;
}

function presenceLookupAliases(participantId: string): string[] {
  const aliases = new Set<string>([participantId, canonicalJid(participantId)]);
  const lid = lidFromJid(participantId);
  if (lid) {
    aliases.add(lid);
  }
  return [...aliases];
}

function addPresenceAlias(
  index: Map<string, PresenceIdentity | null>,
  alias: string,
  identity: PresenceIdentity,
): void {
  const current = index.get(alias);
  if (current === undefined) {
    index.set(alias, identity);
    return;
  }
  if (current !== identity) {
    index.set(alias, null);
  }
}

function resolvePresenceIdentity(
  directory: PresenceDirectory,
  participantId: string,
): PresenceIdentity | null {
  const direct = directory.byJid.get(canonicalJid(participantId));
  if (direct) {
    return direct;
  }

  const lid = lidFromJid(participantId);
  if (lid) {
    const byLid = directory.byLid.get(lid);
    if (byLid) {
      return byLid;
    }
  }

  const phone = phoneFromJid(participantId);
  if (phone) {
    const byPhone = directory.byPhone.get(phone);
    if (byPhone) {
      return byPhone;
    }
  }

  return null;
}

function readEventTimestamp(value: unknown): Date | null {
  if (typeof value === 'string' && value.length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return readTimestampValue(value);
}

function readLastSeenTimestamp(value: unknown, reference: Date): Date | null {
  const date = readTimestampValue(value);
  if (!date) {
    return null;
  }
  // A timestamp in the future is not trustworthy. A small clock skew is accepted.
  if (date.getTime() > reference.getTime() + 5 * 60 * 1000) {
    return null;
  }
  return date;
}

function readTimestampValue(value: unknown): Date | null {
  if (isRecord(value)) {
    const low = typeof value.low === 'number' ? value.low : null;
    const high = typeof value.high === 'number' ? value.high : null;
    if (low !== null && high !== null) {
      return toDate(high * 2 ** 32 + (low >>> 0));
    }
    return null;
  }

  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric) && numeric > 0 ? toDate(numeric) : null;
}

function toDate(value: number): Date | null {
  const millis = value > 1e12 ? value : value * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ParsedContact {
  name: string | null;
  phone: string | null;
}

function extractContacts(message: unknown): ParsedContact[] | null {
  if (!isRecord(message)) {
    return null;
  }

  const single = isRecord(message.contactMessage) ? message.contactMessage : null;
  if (single) {
    const contact = parseContact(single);
    return contact ? [contact] : null;
  }

  const array = isRecord(message.contactsArrayMessage) ? message.contactsArrayMessage : null;
  if (array && Array.isArray(array.contacts)) {
    const contacts = array.contacts
      .filter(isRecord)
      .map(parseContact)
      .filter((contact): contact is ParsedContact => contact !== null);
    return contacts.length > 0 ? contacts : null;
  }

  return null;
}

function parseContact(value: Record<string, unknown>): ParsedContact | null {
  const displayName = readString(value.displayName);
  const vcard = readString(value.vcard);
  const parsed = vcard ? parseVcard(vcard) : { name: null, phone: null };
  const name = displayName ?? parsed.name;

  if (!name && !parsed.phone) {
    return null;
  }

  return { name, phone: parsed.phone };
}

function parseVcard(vcard: string): { name: string | null; phone: string | null } {
  let name: string | null = null;
  let phone: string | null = null;

  for (const rawLine of vcard.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!name && /^FN[:;]/i.test(line)) {
      name = readString(line.slice(line.indexOf(':') + 1).trim());
    } else if (!phone && /^TEL[:;]/i.test(line)) {
      const waid = /waid=(\d+)/i.exec(line);
      phone = waid ? waid[1] : readString(line.slice(line.indexOf(':') + 1).trim());
    }
  }

  return { name, phone };
}
