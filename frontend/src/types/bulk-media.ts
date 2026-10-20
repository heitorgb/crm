export type BulkMediaBatchStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED';

export type BulkMediaRecipientStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface BulkMediaRecipient {
  id: string;
  conversationId: string;
  name: string;
  status: BulkMediaRecipientStatus;
  errorCode: string | null;
  errorMessage: string | null;
  messageId: string | null;
  externalMessageId: string | null;
  processedAt: string | null;
}

export interface BulkMediaBatch {
  id: string;
  caption: string | null;
  fileName: string;
  mimeType: string;
  status: BulkMediaBatchStatus;
  totalCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
  recipients: BulkMediaRecipient[];
}
