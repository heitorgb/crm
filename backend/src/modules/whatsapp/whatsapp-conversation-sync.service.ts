import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isGroupJid, phoneFromJid } from '../../common/whatsapp/jid.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';

export interface SyncInstance {
  id: string;
  tenantId: string;
  instanceName: string;
}

interface NormalizedParticipant {
  jid: string;
  phone: string | null;
  name: string | null;
  avatarUrl: string | null;
  isAdmin?: boolean;
}

const ADMIN_ROLES = new Set(['admin', 'superadmin']);

/**
 * Incremental synchronization of chat/group metadata coming from Evolution.
 * It only touches conversations that already belong to the instance and never
 * changes inbox state (archived, pinned, read marker, last message) or deletes
 * history. Provider events are the source of truth only for group metadata and
 * participant membership; CRM-managed fields are preserved.
 */
@Injectable()
export class WhatsAppConversationSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async syncChat(instance: SyncInstance, rawChat: unknown): Promise<boolean> {
    if (!isRecord(rawChat)) {
      return false;
    }

    const remoteJid =
      readString(rawChat.remoteJid) ?? readString(rawChat.id) ?? readString(rawChat.jid);
    if (!remoteJid) {
      return false;
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: instance.tenantId,
        whatsappInstanceId: instance.id,
        externalContactId: remoteJid,
      },
      select: { id: true, isGroup: true, groupName: true, avatarUrl: true },
    });
    if (!conversation) {
      return false;
    }

    // Individual chat names are the contact's push name. They are handled by
    // the contact synchronization rules (which preserve manual CRM names).
    if (!conversation.isGroup && !isGroupJid(remoteJid)) {
      return false;
    }

    const name =
      readString(rawChat.name) ??
      readString(rawChat.subject) ??
      readString(rawChat.groupName);
    const pictureUrl =
      readString(rawChat.pictureUrl) ??
      readString(rawChat.profilePictureUrl) ??
      readString(rawChat.avatar);

    const data: Prisma.ConversationUpdateInput = {};
    if (!conversation.isGroup) {
      data.isGroup = true;
    }
    if (name && name !== conversation.groupName) {
      data.groupName = name;
    }
    if (pictureUrl && pictureUrl !== conversation.avatarUrl) {
      data.avatarUrl = pictureUrl;
    }
    if (Object.keys(data).length === 0) {
      return false;
    }

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data,
    });
    this.publish(instance.tenantId, conversation.id);
    return true;
  }

  async syncGroup(
    instance: SyncInstance,
    rawGroup: unknown,
    options: { replaceParticipants: boolean },
  ): Promise<boolean> {
    if (!isRecord(rawGroup)) {
      return false;
    }

    const groupJid =
      readString(rawGroup.id) ??
      readString(rawGroup.groupJid) ??
      readString(rawGroup.jid);
    if (!groupJid || !isGroupJid(groupJid)) {
      return false;
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: instance.tenantId,
        whatsappInstanceId: instance.id,
        externalContactId: groupJid,
      },
      select: { id: true, isGroup: true, groupName: true, avatarUrl: true },
    });
    if (!conversation) {
      return false;
    }

    const subject =
      readString(rawGroup.subject) ??
      readString(rawGroup.name) ??
      readString(rawGroup.groupName);
    const pictureUrl =
      readString(rawGroup.pictureUrl) ??
      readString(rawGroup.profilePictureUrl) ??
      readString(rawGroup.avatar);

    const data: Prisma.ConversationUpdateInput = {};
    if (!conversation.isGroup) {
      data.isGroup = true;
    }
    if (subject && subject !== conversation.groupName) {
      data.groupName = subject;
    }
    if (pictureUrl && pictureUrl !== conversation.avatarUrl) {
      data.avatarUrl = pictureUrl;
    }

    let metadataChanged = false;
    if (Object.keys(data).length > 0) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data,
      });
      metadataChanged = true;
    }

    let participantsChanged = false;
    if (options.replaceParticipants && Array.isArray(rawGroup.participants)) {
      participantsChanged = await this.replaceParticipants(
        instance,
        conversation.id,
        rawGroup.participants,
      );
    }

    if (metadataChanged || participantsChanged) {
      this.publish(instance.tenantId, conversation.id);
      return true;
    }
    return false;
  }

  async syncGroupParticipants(instance: SyncInstance, payload: unknown): Promise<boolean> {
    if (!isRecord(payload)) {
      return false;
    }

    const groupJid =
      readString(payload.id) ??
      readString(payload.groupJid) ??
      readString(payload.jid);
    if (!groupJid || !isGroupJid(groupJid)) {
      return false;
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
      return false;
    }

    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    const participantsData = Array.isArray(payload.participantsData)
      ? payload.participantsData
      : [];
    const normalized = mergeParticipantData(participants, participantsData);
    if (normalized.length === 0) {
      return false;
    }

    const action = (readString(payload.action) ?? '').toLowerCase();
    let changed: boolean;
    if (action === 'remove') {
      changed = await this.deactivateParticipants(conversation.id, normalized);
    } else if (action === 'promote') {
      changed = await this.upsertParticipants(
        instance,
        conversation.id,
        normalized.map((participant) => ({ ...participant, isAdmin: true })),
      );
    } else if (action === 'demote') {
      changed = await this.upsertParticipants(
        instance,
        conversation.id,
        normalized.map((participant) => ({ ...participant, isAdmin: false })),
      );
    } else {
      changed = await this.upsertParticipants(instance, conversation.id, normalized);
    }

    if (changed) {
      this.publish(instance.tenantId, conversation.id);
    }
    return changed;
  }

  /** Manual reconciliation of a group participant list (refresh-group action). */
  async syncGroupParticipantsSnapshot(
    instance: SyncInstance,
    groupJid: string,
    participants: unknown[],
  ): Promise<boolean> {
    if (!isGroupJid(groupJid) || participants.length === 0) {
      return false;
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
      return false;
    }

    const changed = await this.replaceParticipants(instance, conversation.id, participants);
    if (changed) {
      this.publish(instance.tenantId, conversation.id);
    }
    return changed;
  }

  /** Full participant list from a `groups.upsert` metadata payload. */
  private async replaceParticipants(
    instance: SyncInstance,
    conversationId: string,
    rawParticipants: unknown[],
  ): Promise<boolean> {
    const normalized = mergeParticipantData(rawParticipants, []);
    if (normalized.length === 0) {
      return false;
    }

    const changed = await this.upsertParticipants(instance, conversationId, normalized);
    const active = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, active: true },
      select: { jid: true },
    });
    const incoming = new Set(normalized.map((participant) => participant.jid));
    const removed = active.map((participant) => participant.jid).filter((jid) => !incoming.has(jid));
    if (removed.length === 0) {
      return changed;
    }

    const now = new Date();
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, jid: { in: removed } },
      data: { active: false, leftAt: now },
    });
    return true;
  }

  private async upsertParticipants(
    instance: SyncInstance,
    conversationId: string,
    participants: NormalizedParticipant[],
  ): Promise<boolean> {
    const existing = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, jid: { in: participants.map((participant) => participant.jid) } },
      select: {
        jid: true,
        phone: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
        active: true,
      },
    });
    const existingByJid = new Map(existing.map((participant) => [participant.jid, participant]));

    const operations: Prisma.PrismaPromise<unknown>[] = [];
    let changed = false;
    const now = new Date();

    for (const participant of participants) {
      const current = existingByJid.get(participant.jid);
      const isAdmin = participant.isAdmin ?? current?.isAdmin ?? false;

      if (!current) {
        operations.push(
          this.prisma.conversationParticipant.create({
            data: {
              tenantId: instance.tenantId,
              conversationId,
              jid: participant.jid,
              phone: participant.phone,
              name: participant.name,
              avatarUrl: participant.avatarUrl,
              isAdmin,
              active: true,
              joinedAt: now,
            },
          }),
        );
        changed = true;
        continue;
      }

      const data: Prisma.ConversationParticipantUpdateInput = {};
      if (participant.phone && participant.phone !== current.phone) {
        data.phone = participant.phone;
      }
      if (participant.name && participant.name !== current.name) {
        data.name = participant.name;
      }
      if (participant.avatarUrl && participant.avatarUrl !== current.avatarUrl) {
        data.avatarUrl = participant.avatarUrl;
      }
      if (participant.isAdmin !== undefined && participant.isAdmin !== current.isAdmin) {
        data.isAdmin = participant.isAdmin;
      }
      if (!current.active) {
        data.active = true;
        data.leftAt = null;
        data.joinedAt = now;
      }
      if (Object.keys(data).length === 0) {
        continue;
      }

      operations.push(
        this.prisma.conversationParticipant.update({
          where: { conversationId_jid: { conversationId, jid: participant.jid } },
          data,
        }),
      );
      changed = true;
    }

    if (operations.length > 0) {
      await this.prisma.$transaction(operations);
    }
    return changed;
  }

  private async deactivateParticipants(
    conversationId: string,
    participants: NormalizedParticipant[],
  ): Promise<boolean> {
    const jids = participants.map((participant) => participant.jid);
    const active = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, jid: { in: jids }, active: true },
      select: { jid: true },
    });
    if (active.length === 0) {
      return false;
    }

    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, jid: { in: active.map((participant) => participant.jid) } },
      data: { active: false, leftAt: new Date() },
    });
    return true;
  }

  private publish(tenantId: string, conversationId: string): void {
    this.realtime.emitToTenant(tenantId, 'conversation.updated', { conversationId });
  }
}

function mergeParticipantData(
  rawParticipants: unknown[],
  rawParticipantsData: unknown[],
): NormalizedParticipant[] {
  const byJid = new Map<string, NormalizedParticipant>();

  for (const item of rawParticipants) {
    const participant = normalizeParticipant(item);
    if (participant) {
      byJid.set(participant.jid, participant);
    }
  }

  for (const item of rawParticipantsData) {
    const participant = normalizeParticipant(item);
    if (!participant) {
      continue;
    }
    const current = byJid.get(participant.jid);
    byJid.set(participant.jid, {
      jid: participant.jid,
      phone: participant.phone ?? current?.phone ?? null,
      name: participant.name ?? current?.name ?? null,
      avatarUrl: participant.avatarUrl ?? current?.avatarUrl ?? null,
      isAdmin: participant.isAdmin ?? current?.isAdmin,
    });
  }

  return [...byJid.values()];
}

function normalizeParticipant(value: unknown): NormalizedParticipant | null {
  if (typeof value === 'string' && value.length > 0) {
    return {
      jid: value,
      phone: phoneFromJid(value),
      name: null,
      avatarUrl: null,
    };
  }
  if (!isRecord(value)) {
    return null;
  }

  const jid =
    readString(value.id) ??
    readString(value.jid) ??
    readString(value.remoteJid) ??
    readString(value.participant);
  if (!jid) {
    return null;
  }

  const phone =
    normalizePhone(readString(value.phoneNumber) ?? readString(value.phone)) ??
    phoneFromJid(jid);
  const name =
    readString(value.name) ??
    readString(value.pushName) ??
    readString(value.notify) ??
    null;
  const avatarUrl =
    readString(value.imgUrl) ??
    readString(value.avatarUrl) ??
    readString(value.profilePicUrl) ??
    readString(value.profilePictureUrl) ??
    null;

  let isAdmin: boolean | undefined;
  const admin = readString(value.admin);
  if (admin) {
    isAdmin = ADMIN_ROLES.has(admin.toLowerCase());
  } else if (typeof value.isAdmin === 'boolean') {
    isAdmin = value.isAdmin;
  }

  return { jid, phone, name, avatarUrl, ...(isAdmin !== undefined ? { isAdmin } : {}) };
}

function normalizePhone(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
