import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
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
import { WhatsAppDirectoryService } from '../whatsapp/whatsapp-directory.service.js';
import {
  WhatsAppInstancesService,
  type ResolvedInstance,
} from '../whatsapp/whatsapp-instances.service.js';

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

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instances: WhatsAppInstancesService,
    private readonly contacts: ContactsService,
    private readonly directory: WhatsAppDirectoryService,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    private readonly transcriptionSettings: TranscriptionSettingsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async ingestEvolution(payload: unknown): Promise<WebhookIngestResult> {
    try {
      const result = await this.processEvolution(payload);
      this.traceWebhook(payload, result);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to process webhook event: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { accepted: false, ignored: 'processing_error' };
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
        messageType: data ? readString(data.messageType) ?? readString(data.status) : null,
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

  private async processEvolution(payload: unknown): Promise<WebhookIngestResult> {
    if (!isRecord(payload)) {
      return { accepted: false, ignored: 'invalid_payload' };
    }

    const eventType = readString(payload.event) ?? 'unknown';
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

    // History sync batches are large and idempotent at the message level.
    // Handling them before `recordEvent` avoids storing the whole batch payload
    // in webhook_events while still importing every missing message.
    if (eventType === 'messages.set' || eventType === 'MESSAGES_SET') {
      if (!this.config.get('WHATSAPP_HISTORY_IMPORT_ENABLED')) {
        return { accepted: true, ignored: 'history_import_disabled' };
      }

      await this.handleMessagesSet(instance, payload);
      return { accepted: true };
    }

    const externalEventId = computeEventId(payload, eventType, instanceName);

    const duplicate = await this.recordEvent({
      tenantId: instance.tenantId,
      externalEventId,
      eventType,
      payload,
    });
    if (duplicate) {
      return { accepted: true, ignored: 'duplicate_event' };
    }

    if (eventType === 'groups.upsert' || eventType === 'groups.update') {
      await this.handleGroupUpsert(instance, payload);
      return { accepted: true };
    }

    // Evolution v2 reports the session lifecycle as `connection.update`. It is
    // authoritative evidence of a degraded session (conflict, device_removed,
    // connection closed) that `connectionState: open` alone can hide, so it is
    // persisted and broadcast to the tenant.
    if (eventType === 'connection.update' || eventType === 'CONNECTION_UPDATE') {
      await this.handleConnectionUpdate(instance, payload);
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

  private async handleMessagesSet(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const records = toArray(payload.data).filter(isRecord);
    const isLatest = payload.isLatest === true;
    const progress = typeof payload.progress === 'number' ? payload.progress : null;
    const result = await this.ingestHistoryMessages(instance, records, {
      cutoff: this.historyCutoff(),
      emitRecentRealtime: true,
      source: 'messages.set',
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
      })}`,
    );
  }

  /**
   * Imports history messages with the same idempotent pipeline used by live
   * events. Messages already stored by (tenantId, externalMessageId) are
   * skipped, so a webhook batch and a manual backfill can overlap safely.
   */
  async ingestHistoryMessages(
    instance: ResolvedInstance,
    records: unknown[],
    options: { cutoff: number; emitRecentRealtime?: boolean; source: string },
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
        occurredAt !== null &&
        occurredAt.getTime() >= Date.now() - HISTORY_REALTIME_WINDOW_MS;

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

    return {
      received: ordered.length,
      imported,
      skipped,
      failed,
      conversations: conversations.size,
    };
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

    const reaction = readReaction(message);
    if (reaction && !reaction.emoji) {
      return { accepted: true, ignored: 'reaction_removed' };
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

    const content = reaction ? reaction.emoji : extractText(message);
    const type = reaction ? MessageType.REACTION : detectType(message);
    const audioDurationSeconds = type === MessageType.AUDIO ? readAudioDuration(message) : null;
    const linkPreview = extractWhatsAppLinkPreview(message);
    const externalMessageId = readString(key?.id);
    const quoted = await this.resolveInboundQuoted(instance.tenantId, message);
    const contacts = extractContacts(message);
    const occurredAt = readMessageTimestamp(data);
    const recent =
      occurredAt !== null &&
      occurredAt.getTime() >= Date.now() - HISTORY_REALTIME_WINDOW_MS;
    const processRecentMedia = !options.history || recent;

    const senderId = fromMe
      ? null
      : reaction
        ? (participant ?? participantAlt ?? (isGroup ? null : remoteJid))
        : isGroup
          ? participant
          : null;
    const senderName = fromMe ? null : isGroup || reaction ? pushName : null;

    const persisted = await this.persistWebhookMessage({
      tenantId: instance.tenantId,
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
        ...(reaction
          ? {
              reaction: {
                targetMessageId: reaction.targetMessageId,
                targetFromMe: reaction.targetFromMe,
              },
            }
          : {}),
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

  private async handlePresence(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const data = isRecord(payload.data) ? payload.data : null;
    const remoteJid = readString(data?.id);
    const presences = data && isRecord(data.presences) ? data.presences : null;
    if (!remoteJid || !presences) return;

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: instance.tenantId,
        whatsappInstanceId: instance.id,
        externalContactId: remoteJid,
      },
      select: { id: true },
    });
    if (!conversation) return;

    for (const [participantId, presence] of Object.entries(presences)) {
      const state = isRecord(presence) ? readString(presence.lastKnownPresence) : null;
      if (
        !state ||
        !['composing', 'recording', 'paused', 'available', 'unavailable'].includes(state)
      )
        continue;
      this.realtime.emitToTenant(instance.tenantId, 'conversation.presence', {
        conversationId: conversation.id,
        participantId,
        state,
      });
    }
  }

  private async handleConnectionUpdate(
    instance: ResolvedInstance,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const data = isRecord(payload.data) ? payload.data : null;
    const state = readString(data?.state) ?? readString(data?.connection);
    const statusReason = readString(data?.statusReason) ?? readString(data?.reason);

    const result = await this.instances.applyProviderConnectionState(instance.instanceName, state);
    if (!result) {
      return;
    }

    this.logger.log(
      `Connection update for ${instance.instanceName}: ${state ?? 'unknown'} -> ${result.status}${
        statusReason ? ` (${statusReason})` : ''
      }`,
    );

    if (!result.changed) {
      return;
    }

    this.realtime.emitToTenant(instance.tenantId, 'whatsapp.instance.updated', {
      instanceId: result.instanceId,
      status: result.status,
      reason: statusReason,
    });
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
      this.logger.warn(`Ignoring message edit without usable content (instance ${instance.instanceName})`);
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

    this.realtime.emitToConversation(
      instance.tenantId,
      updated.conversationId,
      'message.updated',
      {
        conversationId: updated.conversationId,
        messageId: updated.messageId,
      },
    );
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

  private async recordEvent(input: {
    tenantId: string;
    externalEventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          tenantId: input.tenantId,
          provider: 'evolution',
          externalEventId: input.externalEventId,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
      return false;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return true;
      }
      throw error;
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
  ) {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, whatsappInstanceId, externalContactId },
      select: { id: true, status: true, contactId: true, groupName: true, isGroup: true, externalLid: true },
    });

    if (existing) {
      const data: Prisma.ConversationUncheckedUpdateInput = {};
      if (reopenClosed && existing.status === ConversationStatus.CLOSED) {
        data.status = ConversationStatus.OPEN;
        data.closedAt = null;
      }
      if (!isGroup && !existing.contactId && contactId) {
        data.contactId = contactId;
      }
      if (!isGroup && externalLid && existing.externalLid !== externalLid) {
        data.externalLid = externalLid;
      }
      if (isGroup && !existing.isGroup) {
        data.isGroup = true;
      }

      if (Object.keys(data).length === 0) {
        return existing;
      }

      return this.prisma.conversation.update({
        where: { id: existing.id },
        data,
        select: { id: true, status: true, groupName: true },
      });
    }

    return this.prisma.conversation.create({
      data: {
        tenantId,
        whatsappInstanceId,
        externalContactId,
        externalLid: isGroup ? null : externalLid,
        contactId,
        isGroup,
        status: ConversationStatus.OPEN,
      },
      select: { id: true, status: true, groupName: true },
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
  ): Promise<void> {
    const groups = toArray(payload.data).filter(isRecord);

    for (const group of groups) {
      const groupJid = readString(group.id) ?? readString(group.groupJid);
      if (!groupJid) {
        continue;
      }

      const conversation = await this.prisma.conversation.findFirst({
        where: {
          tenantId: instance.tenantId,
          whatsappInstanceId: instance.id,
          externalContactId: groupJid,
        },
        select: { id: true },
      });
      if (!conversation) {
        continue;
      }

      const subject = readString(group.subject) ?? readString(group.name);
      const pictureUrl =
        readString(group.pictureUrl) ??
        readString(group.profilePictureUrl) ??
        readString(group.avatar);

      const data: Prisma.ConversationUpdateInput = { isGroup: true };
      if (subject) data.groupName = subject;
      if (pictureUrl) data.avatarUrl = pictureUrl;

      await this.prisma.conversation.update({ where: { id: conversation.id }, data });
      this.realtime.emitToTenant(instance.tenantId, 'conversation.updated', {
        conversationId: conversation.id,
      });
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
        where: { tenantId: input.tenantId, externalMessageId: input.externalMessageId },
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
          where: { tenantId: input.tenantId, externalMessageId: input.externalMessageId },
          select: { id: true },
        });
        return raced ? { id: raced.id, created: false } : null;
      }
      throw error;
    }
  }

  /** Extracts the quoted message context of a reply, enriching it from the local history. */
  private async resolveInboundQuoted(
    tenantId: string,
    message: unknown,
  ): Promise<QuotedMessageInfo | null> {
    const contextInfo = findContextInfo(message);
    if (!contextInfo) {
      return null;
    }

    const externalId = readString(contextInfo.stanzaId);
    const authorJid = readString(contextInfo.participant);
    const quotedRaw = contextInfo.quotedMessage;
    let content = extractText(quotedRaw);
    let type = detectType(quotedRaw);
    let authorName: string | null = null;
    let fromMe = false;
    let messageId: string | null = null;

    if (externalId) {
      const local = await this.prisma.message.findFirst({
        where: { tenantId, externalMessageId: externalId },
        select: { id: true, direction: true, senderName: true, content: true, type: true },
      });
      if (local) {
        messageId = local.id;
        fromMe = local.direction === MessageDirection.OUTBOUND;
        authorName = local.senderName;
        content = local.content ?? content;
        type = local.type;
      }
    }

    return { messageId, externalId, authorName, authorJid, fromMe, content, type };
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
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
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

function findContextInfo(message: unknown): Record<string, unknown> | null {
  if (!isRecord(message)) {
    return null;
  }
  for (const part of CONTEXT_MESSAGE_PARTS) {
    const node = message[part];
    if (isRecord(node) && isRecord(node.contextInfo)) {
      return node.contextInfo;
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
  const adReply = contextInfo && isRecord(contextInfo.externalAdReply)
    ? contextInfo.externalAdReply
    : null;
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

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
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
