export type WhatsAppInstanceStatus = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';
export type WhatsAppHistorySyncStatus = 'IDLE' | 'SYNCING' | 'COMPLETED' | 'FAILED';

export interface WhatsAppHistorySync {
  status: WhatsAppHistorySyncStatus;
  progress: number | null;
  chunks: number | null;
  messages: number | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  error: string | null;
}

export interface WhatsAppInstance {
  id: string;
  name: string;
  instanceName: string;
  externalInstanceId: string | null;
  phone: string | null;
  status: WhatsAppInstanceStatus;
  statusReason: number | null;
  connectionObservedAt: string | null;
  active: boolean;
  hasCredentials: boolean;
  historySync: WhatsAppHistorySync;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppQuota {
  used: number;
  canCreate: boolean;
}

export interface WhatsAppConnectionTicket {
  status: WhatsAppInstanceStatus;
  qrCodeBase64: string | null;
  pairingCode: string | null;
  code: string | null;
  updatedAt?: string;
}

export interface WhatsAppConnectionStatus {
  status: WhatsAppInstanceStatus;
  reason?: number | null;
}

export interface WhatsAppQrEvent {
  instanceId: string;
  qrCodeBase64: string | null;
  pairingCode: string | null;
  code: string | null;
  updatedAt: string;
}

export interface WhatsAppWebhookResult {
  webhookConfigured: boolean;
  webhookUrl: string;
}

export interface WhatsAppCredentialsInput {
  apiKey?: string;
  webhookSecret?: string;
}

export interface WhatsAppInstanceInput {
  name: string;
  instanceName: string;
  phone?: string | null;
  credentials?: WhatsAppCredentialsInput;
  active?: boolean;
}

export interface WhatsAppInstanceUpdateInput {
  name?: string;
  phone?: string | null;
  active?: boolean;
  credentials?: WhatsAppCredentialsInput;
}
