export type WhatsAppInstanceStatus = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';

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

export interface WhatsAppConnectionTicket {
  status: WhatsAppInstanceStatus;
  qrCodeBase64: string | null;
  pairingCode: string | null;
  code: string | null;
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
