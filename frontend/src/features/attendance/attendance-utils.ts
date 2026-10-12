import { format, isToday, isYesterday } from 'date-fns';
import type { Conversation, ConversationStatus } from '@/types/attendance';

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
