import type { PageResult } from './crm';

export type { PageResult };

export type BillingChargeStatus = 'PENDING' | 'OVERDUE' | 'PAID' | 'CANCELED';
export type BillingReminderStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'SKIPPED';
export type BillingReminderOrigin = 'AUTOMATIC' | 'MANUAL';
export type BillingRecurrenceFrequency = 'MONTHLY';

export interface BillingCharge {
  id: string;
  customerId: string | null;
  customerName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  recurrenceId: string | null;
  description: string;
  amountCents: number;
  dueDate: string;
  status: BillingChargeStatus;
  paidAt: string | null;
  paidByUserId: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingReminder {
  id: string;
  chargeId: string;
  offsetDays: number;
  origin: BillingReminderOrigin;
  createdByUserId: string | null;
  scheduledFor: string;
  status: BillingReminderStatus;
  attempts: number;
  destination: string | null;
  whatsappInstanceId: string | null;
  externalMessageId: string | null;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
}

export interface BillingRecurrence {
  id: string;
  customerId: string | null;
  customerName: string | null;
  contactId: string | null;
  contactName: string | null;
  description: string;
  amountCents: number;
  frequency: BillingRecurrenceFrequency;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillingSettings {
  remindersEnabled: boolean;
  reminderOffsets: number[];
  messageTemplate: string;
  whatsappInstanceId: string | null;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
}

export interface BillingOverview {
  period: { from: string; to: string };
  totalPendingCents: number;
  totalOverdueCents: number;
  totalPaidCents: number;
  pendingCount: number;
  overdueCount: number;
  paidCount: number;
  failedReminders: number;
  upcoming: BillingCharge[];
}

export interface BillingChargeInput {
  customerId?: string | null;
  contactId?: string | null;
  description: string;
  amountCents: number;
  dueDate: string;
  recurrence?: { frequency: BillingRecurrenceFrequency; endDate?: string | null };
}

export interface BillingRecurrenceInput {
  customerId?: string | null;
  contactId?: string | null;
  description: string;
  amountCents: number;
  startDate: string;
  endDate?: string | null;
  frequency?: BillingRecurrenceFrequency;
}
