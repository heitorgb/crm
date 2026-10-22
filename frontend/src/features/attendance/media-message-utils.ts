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

export function isVideoMessage(message: ConversationMessage): boolean {
  if (message.type === 'VIDEO') {
    return true;
  }
  if (message.type !== 'DOCUMENT' && message.type !== 'UNKNOWN') {
    return false;
  }
  return message.attachments[0]?.mimeType.toLowerCase().startsWith('video/') ?? false;
}

/**
 * A view-once message is received through the view-once envelope. WhatsApp does
 * not let the CRM open or download its content, so it is never treated as
 * pending media and its payload is not rendered.
 */
export function isViewOnceMessage(message: ConversationMessage): boolean {
  return message.metadata?.viewOnce === true;
}

export function isMediaPending(message: ConversationMessage): boolean {
  return (
    !isViewOnceMessage(message) &&
    isMediaMessage(message) &&
    message.attachments.length === 0 &&
    mediaErrorLabel(message.metadata) === null
  );
}
