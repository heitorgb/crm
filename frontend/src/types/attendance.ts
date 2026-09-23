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
  | 'UNKNOWN';

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
  occurredAt: string;
}

export interface Conversation {
  id: string;
  status: ConversationStatus;
  subject: string | null;
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
  metadata: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
  attachments: {
    id: string;
    storageKey: string;
    fileName: string;
    mimeType: string;
    size: number;
  }[];
}

