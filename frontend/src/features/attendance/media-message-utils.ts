import type { ConversationMessage } from '@/types/attendance';

const MEDIA_TYPES: ConversationMessage['type'][] = [
  'IMAGE',
  'AUDIO',
  'VIDEO',
  'DOCUMENT',
  'STICKER',
];

export function mediaErrorLabel(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) {
    return null;
  }
  const error = metadata.mediaError;
  if (error === 'too_large') {
    return 'Arquivo maior que o permitido';
  }
  if (typeof error === 'string') {
    return 'Mídia indisponível';
  }
  return null;
}

export function isMediaMessage(message: ConversationMessage): boolean {
  return MEDIA_TYPES.includes(message.type);
}

export function isMediaPending(message: ConversationMessage): boolean {
  return (
    isMediaMessage(message) &&
    message.attachments.length === 0 &&
    mediaErrorLabel(message.metadata) === null
  );
}
