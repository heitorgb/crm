export type WhatsAppInstanceStatus = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';

export type ConversationStatus =
  | 'BOT_QUALIFYING'
  | 'QUALIFIED_WAITING_DIGEST'
  | 'DISQUALIFIED'
  | 'NEEDS_HUMAN'
  | 'HUMAN'
  | 'CLOSED';

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
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  customerId: string | null;
  customerName: string | null;
  contactId: string | null;
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

export type TicketStatus = 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  conversationId: string | null;
  leadId: string | null;
  leadName: string | null;
  customerId: string | null;
  customerName: string | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DigestChannel = 'INTERNAL' | 'WHATSAPP' | 'EMAIL';
export type DigestStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface DigestPreference {
  id: string;
  enabled: boolean;
  frequency: 'DAILY';
  deliveryTime: string;
  timeZone: string;
  channel: DigestChannel;
  whatsappDestination: string | null;
  includeOnlyAssigned: boolean;
  lastDeliveredAt: string | null;
  updatedAt: string;
}

export interface DigestDelivery {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: DigestStatus;
  leadCount: number;
  channel: DigestChannel;
  externalMessageId: string | null;
  errorCode: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface DigestLeadSummary {
  leadId: string;
  name: string | null;
  phone: string | null;
  score: number | null;
  qualificationLevel: string | null;
  summary: string;
  recommendedNextStep: string | null;
  qualificationReasons: unknown[];
}

export interface DigestOverview {
  awaitingDigest: DigestLeadSummary[];
  needsHuman: { conversationId: string; leadName: string | null; status: string }[];
  recentDeliveries: DigestDelivery[];
}
