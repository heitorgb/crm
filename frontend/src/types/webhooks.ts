export type WebhookExecutionStatus = 'PROCESSING' | 'SUCCESS' | 'FAILED';

export interface WebhookIntegration {
  id: string;
  name: string;
  whatsappInstanceId: string;
  instanceName: string;
  instanceStatus: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';
  groupJid: string;
  groupName: string | null;
  active: boolean;
  secretHint: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookIntegrationWithSecret extends WebhookIntegration {
  secret: string;
}

export interface WebhookIntegrationInput {
  name: string;
  whatsappInstanceId: string;
  groupJid: string;
  groupName?: string;
  active?: boolean;
}

export interface WebhookGroup {
  jid: string;
  name: string | null;
  size: number | null;
}

export interface WebhookExecution {
  id: string;
  status: WebhookExecutionStatus;
  externalMessageId: string | null;
  messageId: string | null;
  conversationId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}
