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
} as const;
