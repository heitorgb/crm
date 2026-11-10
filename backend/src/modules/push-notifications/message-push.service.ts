import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MessageDirection, MessageType } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { FcmClient, type PushMessage } from '../../infrastructure/push/fcm.client.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const BODY_MAX_LENGTH = 120;
const ATTENDANCE_PATH = '/atendimento/conversas';

const MEDIA_LABELS: Partial<Record<MessageType, string>> = {
  [MessageType.IMAGE]: '📷 Foto',
  [MessageType.AUDIO]: '🎤 Áudio',
  [MessageType.VIDEO]: '🎥 Vídeo',
  [MessageType.DOCUMENT]: '📄 Documento',
  [MessageType.LOCATION]: '📍 Localização',
  [MessageType.CONTACT]: '👤 Contato',
  [MessageType.STICKER]: 'Figurinha',
};

export interface MessagePushJob {
  tenantId: string;
  messageId: string;
}

@Injectable()
export class MessagePushService implements OnModuleInit {
  private readonly logger = new Logger(MessagePushService.name);

  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly fcm: FcmClient,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.PUSH_MESSAGE_NOTIFY, (payload) => this.process(payload));
  }

  /**
   * Delivery is best-effort per device and never throws, so a queue retry can
   * not notify devices that already received the message.
   */
  async process(payload: JobPayload): Promise<void> {
    const job = parseJob(payload);
    if (!job || !this.fcm.isConfigured()) {
      return;
    }

    await this.tenantContext.run(
      {
        tenant: {
          tenantId: job.tenantId,
          userId: SYSTEM_USER_ID,
          membershipId: SYSTEM_MEMBERSHIP_ID,
          role: 'SYSTEM',
        },
      },
      () => this.notify(job),
    );
  }

  private async notify(job: MessagePushJob): Promise<void> {
    const message = await this.prisma.message.findFirst({
      where: { id: job.messageId, tenantId: job.tenantId, direction: MessageDirection.INBOUND },
      select: {
        type: true,
        content: true,
        senderName: true,
        conversation: {
          select: {
            id: true,
            isArchived: true,
            deletedAt: true,
            isGroup: true,
            groupName: true,
            contact: { select: { name: true } },
          },
        },
      },
    });

    const conversation = message?.conversation;
    if (!message || !conversation || conversation.isArchived || conversation.deletedAt) {
      return;
    }

    const devices = await this.prisma.pushDevice.findMany({
      where: {
        tenantId: job.tenantId,
        tenantUser: { tenantId: job.tenantId, active: true, user: { active: true } },
      },
      select: { id: true, token: true },
    });
    if (devices.length === 0) {
      return;
    }

    const push = buildMessagePush({
      conversationId: conversation.id,
      type: message.type,
      content: message.content,
      senderName: message.senderName,
      contactName: conversation.contact?.name ?? null,
      isGroup: conversation.isGroup,
      groupName: conversation.groupName,
    });

    const invalidDeviceIds: string[] = [];
    for (const device of devices) {
      const result = await this.fcm.send(device.token, push);
      if (result === 'invalid-token') {
        invalidDeviceIds.push(device.id);
      }
    }

    if (invalidDeviceIds.length > 0) {
      await this.prisma.pushDevice.deleteMany({
        where: { id: { in: invalidDeviceIds }, tenantId: job.tenantId },
      });
      this.logger.debug(`Removed ${invalidDeviceIds.length} unregistered push device(s)`);
    }
  }
}

export interface MessagePushInput {
  conversationId: string;
  type: MessageType;
  content: string | null;
  senderName: string | null;
  contactName: string | null;
  isGroup: boolean;
  groupName: string | null;
}

export function buildMessagePush(input: MessagePushInput): PushMessage {
  const sender = input.contactName?.trim() || input.senderName?.trim() || 'Nova mensagem';
  const title =
    input.isGroup && input.groupName?.trim()
      ? `${input.senderName?.trim() || 'Grupo'} @ ${input.groupName.trim()}`
      : sender;

  return {
    title,
    body: messagePreview(input.type, input.content),
    tag: input.conversationId,
    data: {
      conversationId: input.conversationId,
      path: `${ATTENDANCE_PATH}?conversation=${encodeURIComponent(input.conversationId)}`,
    },
  };
}

function messagePreview(type: MessageType, content: string | null): string {
  const text = content?.replace(/\s+/g, ' ').trim() ?? '';
  const label = MEDIA_LABELS[type];

  if (type === MessageType.TEXT || !label) {
    return truncate(text) || 'Nova mensagem';
  }
  return text ? truncate(`${label}: ${text}`) : label;
}

function truncate(text: string): string {
  return text.length > BODY_MAX_LENGTH ? `${text.slice(0, BODY_MAX_LENGTH - 1)}…` : text;
}

function parseJob(payload: JobPayload): MessagePushJob | null {
  const { tenantId, messageId } = payload;
  return typeof tenantId === 'string' && typeof messageId === 'string'
    ? { tenantId, messageId }
    : null;
}
