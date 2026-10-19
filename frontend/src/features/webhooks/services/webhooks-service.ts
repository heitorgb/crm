import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type {
  WebhookExecution,
  WebhookGroup,
  WebhookIntegration,
  WebhookIntegrationInput,
  WebhookIntegrationWithSecret,
} from '@/types/webhooks';

export interface ListWebhooksParams {
  page?: number;
  perPage?: number;
  search?: string;
  active?: boolean;
}

export interface ListWebhookExecutionsParams {
  page?: number;
  perPage?: number;
  search?: string;
}

export const webhooksService = {
  list: (params: ListWebhooksParams = {}) =>
    apiRequest<PageResult<WebhookIntegration>>(
      `/integrations/webhooks${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        active: params.active,
      })}`,
    ),

  create: (input: WebhookIntegrationInput) =>
    apiRequest<WebhookIntegrationWithSecret>('/integrations/webhooks', {
      method: 'POST',
      body: input,
    }),

  update: (id: string, input: Partial<WebhookIntegrationInput>) =>
    apiRequest<WebhookIntegration>(`/integrations/webhooks/${id}`, {
      method: 'PATCH',
      body: input,
    }),

  remove: (id: string) =>
    apiRequest<void>(`/integrations/webhooks/${id}`, { method: 'DELETE' }),

  regenerateSecret: (id: string) =>
    apiRequest<WebhookIntegrationWithSecret>(
      `/integrations/webhooks/${id}/regenerate-secret`,
      { method: 'POST', body: {} },
    ),

  listExecutions: (id: string, params: ListWebhookExecutionsParams = {}) =>
    apiRequest<PageResult<WebhookExecution>>(
      `/integrations/webhooks/${id}/executions${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
      })}`,
    ),

  listGroups: (whatsappInstanceId: string) =>
    apiRequest<WebhookGroup[]>(`/integrations/whatsapp/${whatsappInstanceId}/groups`),
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export function buildWebhookExecuteUrl(id: string): string {
  const origin =
    API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${origin}/api/integrations/webhooks/${id}/execute`;
}
