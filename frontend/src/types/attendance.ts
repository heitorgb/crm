export type WhatsAppInstanceStatus = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';

export type ConversationStatus = 'OPEN' | 'CLOSED';

export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export type MessageStatus = 'RECEIVED' | 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export type MessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENT'
  | 'LOCATION'
  | 'CONTACT'
  | 'STICKER'
  | 'REACTION'
  | 'UNKNOWN';

import type { TagSummary } from './crm';

export interface WhatsAppInstance {
  id: string;
  name: string;
  instanceName: string;
  externalInstanceId: string | null;
  phone: string | null;
  status: WhatsAppInstanceStatus;
  active: boolean;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationLastMessage {
  content: string | null;
  direction: MessageDirection;
  senderName: string | null;
  occurredAt: string;
}

export interface Conversation {
  id: string;
  status: ConversationStatus;
  subject: string | null;
  isGroup: boolean;
  groupName: string | null;
  avatarUrl: string | null;
  isPinned: boolean;
  isArchived: boolean;
  unreadCount: number;
  whatsappInstanceId: string;
  instanceName: string;
  externalContactId: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  customerId: string | null;
  customerName: string | null;
  lastMessageAt: string | null;
  lastMessage: ConversationLastMessage | null;
  tags?: TagSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  externalMessageId: string | null;
  status: MessageStatus;
  senderId: string | null;
  senderName: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
  attachments: {
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    hasThumbnail: boolean;
  }[];
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  domain: string;
}

export interface QuotedMessage {
  messageId: string | null;
  externalId: string | null;
  authorName: string | null;
  authorJid: string | null;
  fromMe: boolean;
  content: string | null;
  type: MessageType;
}

export interface ContactEntry {
  name: string | null;
  phone: string | null;
}

