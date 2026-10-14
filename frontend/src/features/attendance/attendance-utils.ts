import { format, isToday, isYesterday } from 'date-fns';
import type {
  ContactEntry,
  Conversation,
  ConversationMessage,
  ConversationStatus,
  MessageType,
  QuotedMessage,
} from '@/types/attendance';
import type { PageResult } from '@/types/crm';

export const conversationStatusTone: Record<ConversationStatus, 'success' | 'secondary'> = {
  OPEN: 'success',
  CLOSED: 'secondary',
};

export const conversationStatusLabel: Record<ConversationStatus, string> = {
  OPEN: 'Aberta',
  CLOSED: 'Encerrada',
};

export function conversationLabel(conversation: Conversation | null | undefined): string {
  if (!conversation) {
    return 'Contato';
  }
  if (conversation.isGroup) {
    return conversation.groupName ?? conversation.externalContactId ?? 'Grupo';
  }
  return (
    conversation.contactName ??
    conversation.contactPhone ??
    conversation.externalContactId ??
    'Contato'
  );
}

export function conversationSubtitle(conversation: Conversation | null | undefined): string {
  if (!conversation) {
    return '';
  }
  if (conversation.isGroup) {
    return `Grupo · ${conversation.instanceName}`;
  }
  const phone = conversation.contactPhone ?? conversation.externalContactId;
  return phone ? `${phone} · ${conversation.instanceName}` : conversation.instanceName;
}

export function conversationPreview(conversation: Conversation): string {
  const last = conversation.lastMessage;
  if (!last) {
    return 'Sem mensagens';
  }
  const text = last.content?.trim();
  if (!text) {
    return 'Mídia';
  }
  if (conversation.isGroup && last.direction === 'INBOUND' && last.senderName) {
    return `${last.senderName}: ${text}`;
  }
  return text;
}

export function formatBubbleTime(value: string | Date): string {
  return format(new Date(value), 'HH:mm');
}

export function formatListTime(value: string): string {
  const date = new Date(value);
  if (isToday(date)) {
    return format(date, 'HH:mm');
  }
  if (isYesterday(date)) {
    return 'Ontem';
  }
  return format(date, 'dd/MM/yyyy');
}

export function dayKey(value: string): string {
  return format(new Date(value), 'yyyy-MM-dd');
}

export function formatDayLabel(value: string): string {
  const date = new Date(value);
  if (isToday(date)) {
    return 'Hoje';
  }
  if (isYesterday(date)) {
    return 'Ontem';
  }
  return format(date, 'dd/MM/yyyy');
}

const MESSAGE_TYPE_LABEL: Partial<Record<MessageType, string>> = {
  IMAGE: 'Imagem',
  VIDEO: 'Vídeo',
  AUDIO: 'Áudio',
  DOCUMENT: 'Documento',
  STICKER: 'Figurinha',
  LOCATION: 'Localização',
  CONTACT: 'Contato',
};

export function messageSnippet(content: string | null, type: MessageType): string {
  const text = content?.trim();
  if (text) {
    return text;
  }
  return MESSAGE_TYPE_LABEL[type] ?? 'Mensagem';
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Identity of the participant that authored a message. Two consecutive
 * messages only belong to the same visual block when this key matches.
 * Messages without any usable identity get a unique key, so distinct senders
 * (or unidentified ones) are never merged into the same block.
 */
function participantKey(message: ConversationMessage, isGroup: boolean): string {
  if (message.direction === 'OUTBOUND') {
    return `outbound:${message.senderId ?? 'self'}`;
  }
  if (!isGroup) {
    return 'inbound:peer';
  }
  const identity = message.senderId ?? message.senderName;
  return identity ? `inbound:${identity}` : `inbound:unidentified:${message.id}`;
}

/**
 * Whether two adjacent messages render as a single compact block. They must
 * share direction, participant identity, day and stay within the time window.
 * Reactions are always standalone so their target stays identifiable.
 */
export function areGrouped(
  previous: ConversationMessage | undefined,
  message: ConversationMessage | undefined,
  isGroup: boolean,
): boolean {
  if (!previous || !message) {
    return false;
  }
  if (previous.direction !== message.direction) {
    return false;
  }
  if (previous.type === 'REACTION' || message.type === 'REACTION') {
    return false;
  }
  if (dayKey(previous.occurredAt) !== dayKey(message.occurredAt)) {
    return false;
  }
  if (participantKey(previous, isGroup) !== participantKey(message, isGroup)) {
    return false;
  }
  const gap = new Date(message.occurredAt).getTime() - new Date(previous.occurredAt).getTime();
  return gap >= 0 && gap <= GROUP_WINDOW_MS;
}

export function readQuotedMessage(message: ConversationMessage): QuotedMessage | null {
  const raw = message.metadata?.quoted;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const quoted = raw as Record<string, unknown>;
  return {
    messageId: typeof quoted.messageId === 'string' ? quoted.messageId : null,
    externalId: typeof quoted.externalId === 'string' ? quoted.externalId : null,
    authorName: typeof quoted.authorName === 'string' ? quoted.authorName : null,
    authorJid: typeof quoted.authorJid === 'string' ? quoted.authorJid : null,
    fromMe: quoted.fromMe === true,
    content: typeof quoted.content === 'string' ? quoted.content : null,
    type: typeof quoted.type === 'string' ? (quoted.type as MessageType) : 'UNKNOWN',
  };
}

export function quotedAuthorLabel(quoted: QuotedMessage): string {
  if (quoted.fromMe) {
    return 'Você';
  }
  return quoted.authorName ?? 'Mensagem';
}

export const QUOTE_HIGHLIGHT_MS = 1800;

/**
 * Resolves a quoted message to the corresponding message already loaded in the
 * conversation. It matches by the internal identifier first and falls back to
 * the external WhatsApp identifier. Content is never used, since distinct
 * messages can share the exact same text. The result is always restricted to
 * the given conversation, so a quote can never resolve across conversations.
 */
export function findQuotedMessage(
  messages: ConversationMessage[],
  conversationId: string,
  quoted: QuotedMessage | null | undefined,
): ConversationMessage | null {
  if (!quoted) {
    return null;
  }
  const withinConversation = (message: ConversationMessage): boolean =>
    message.conversationId === conversationId;
  if (quoted.messageId) {
    const byId = messages.find(
      (message) => message.id === quoted.messageId && withinConversation(message),
    );
    if (byId) {
      return byId;
    }
  }
  if (quoted.externalId) {
    const byExternalId = messages.find(
      (message) => message.externalMessageId === quoted.externalId && withinConversation(message),
    );
    if (byExternalId) {
      return byExternalId;
    }
  }
  return null;
}

export interface MessageScrollMetrics {
  containerTop: number;
  containerHeight: number;
  scrollTop: number;
  scrollHeight: number;
  elementTop: number;
  elementHeight: number;
}

/**
 * Computes the scrollTop that centers the target element inside the message
 * viewport, clamped to the scrollable range. Only the message container moves,
 * so navigating to a quoted message never scrolls the surrounding page.
 */
export function computeMessageScrollTop(metrics: MessageScrollMetrics): number {
  const elementCenter = metrics.elementTop - metrics.containerTop + metrics.elementHeight / 2;
  const desired = metrics.scrollTop + elementCenter - metrics.containerHeight / 2;
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.containerHeight);
  return Math.min(Math.max(desired, 0), maxScrollTop);
}

/**
 * Combines the older history pages (loaded newest page first) with the live
 * newest page into a single ascending timeline. Duplicated ids are dropped, so
 * an overlap caused by messages arriving between two fetches never renders the
 * same message twice.
 */
export function buildTimeline(
  historyPages: PageResult<ConversationMessage>[] | undefined,
  newestMessages: ConversationMessage[],
): ConversationMessage[] {
  const ordered = [
    ...(historyPages ? [...historyPages].reverse().flatMap((page) => page.data) : []),
    ...newestMessages,
  ];
  const seen = new Set<string>();
  const timeline: ConversationMessage[] = [];
  for (const message of ordered) {
    if (seen.has(message.id)) {
      continue;
    }
    seen.add(message.id);
    timeline.push(message);
  }
  return timeline;
}

export function readMessageContacts(
  metadata: Record<string, unknown> | null,
): ContactEntry[] {
  const raw = metadata?.contacts;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const contact = entry as Record<string, unknown>;
    return [
      {
        name: typeof contact.name === 'string' ? contact.name : null,
        phone: typeof contact.phone === 'string' ? contact.phone : null,
      },
    ];
  });
}
