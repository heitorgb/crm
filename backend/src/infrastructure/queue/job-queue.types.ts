export interface JobPayload {
  [key: string]: unknown;
}

export type JobProcessor = (payload: JobPayload) => Promise<void>;

export interface JobQueue {
  enqueue(name: string, payload: JobPayload): Promise<void>;
  registerProcessor(name: string, processor: JobProcessor): void;
  scheduleRepeatable(name: string, everyMs: number, payload: JobPayload): Promise<void>;
  close(): Promise<void>;
}

export const JOB_QUEUE = 'JOB_QUEUE';

export const JOB_NAMES = {
  WHATSAPP_SEND: 'whatsapp.message.send',
  MEDIA_PROCESS: 'media.process',
  CONTACTS_SYNC: 'whatsapp.contacts.sync',
  BILLING_SCAN: 'billing.scan',
  BILLING_REMINDER_SEND: 'billing.reminder.send',
  BULK_MEDIA_SCAN: 'bulk-media.scan',
  BULK_MEDIA_SEND: 'bulk-media.send',
  SCHEDULED_MESSAGE_SCAN: 'scheduled-message.scan',
  SCHEDULED_MESSAGE_SEND: 'scheduled-message.send',
} as const;
