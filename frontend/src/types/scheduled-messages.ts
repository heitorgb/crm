import type { PageResult } from './crm';

export type ScheduledMessageType = 'CAMPAIGN' | 'REMINDER';
export type ScheduledMessageStatus =
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'CANCELED';
export type ScheduledMessageRecurrence = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type ScheduledMessageRecipientStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED';

export interface ScheduledMessage {
  id: string;
  type: ScheduledMessageType;
  title: string;
  content: string;
  valor: string | null;
  recurrence: ScheduledMessageRecurrence;
  timeZone: string;
  scheduledAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  recipientCount: number;
  status: ScheduledMessageStatus;
  canceledAt: string | null;
  hasAttachment: boolean;
  attachmentFileName: string | null;
  attachmentMimeType: string | null;
  attachmentSize: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledMessageRecipientDefinition {
  conversationId: string | null;
  recipientName: string;
  status: ScheduledMessageRecipientStatus;
}

export interface ScheduledMessageRecipientLog {
  id: string;
  recipientName: string;
  conversationId: string | null;
  destination: string;
  status: ScheduledMessageRecipientStatus;
  attempts: number;
  externalMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  processedAt: string | null;
}

export interface ScheduledMessageRunLog {
  scheduledFor: string;
  status: ScheduledMessageRecipientStatus;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  recipients: ScheduledMessageRecipientLog[];
}

export interface ScheduledMessageInput {
  type: ScheduledMessageType;
  title: string;
  content: string;
  valor?: string | null;
  recurrence: ScheduledMessageRecurrence;
  scheduledAt: string;
  conversationIds: string[];
  file?: File | null;
  removeAttachment?: boolean;
}

export type { PageResult };
