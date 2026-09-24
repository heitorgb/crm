import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type {
  WhatsAppConnectionTicket,
  WhatsAppInstance,
  WhatsAppInstanceInput,
  WhatsAppInstanceStatus,
  WhatsAppInstanceUpdateInput,
  WhatsAppWebhookResult,
} from '@/types/whatsapp';

export interface ListWhatsAppInstancesParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: WhatsAppInstanceStatus;
  active?: boolean;
}

export const whatsappService = {
  list: (params: ListWhatsAppInstancesParams = {}) =>
    apiRequest<PageResult<WhatsAppInstance>>(
      `/whatsapp/instances${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        status: params.status,
        active: params.active,
      })}`,
    ),

  create: (input: WhatsAppInstanceInput) =>
    apiRequest<WhatsAppInstance>('/whatsapp/instances', { method: 'POST', body: input }),

  update: (id: string, input: WhatsAppInstanceUpdateInput) =>
    apiRequest<WhatsAppInstance>(`/whatsapp/instances/${id}`, { method: 'PATCH', body: input }),

  remove: (id: string) => apiRequest<void>(`/whatsapp/instances/${id}`, { method: 'DELETE' }),

  connect: (id: string) =>
    apiRequest<WhatsAppConnectionTicket>(`/whatsapp/instances/${id}/connect`, {
      method: 'POST',
      body: {},
    }),

  disconnect: (id: string) =>
    apiRequest<{ status: WhatsAppInstanceStatus }>(`/whatsapp/instances/${id}/disconnect`, {
      method: 'POST',
      body: {},
    }),

  status: (id: string) =>
    apiRequest<{ status: WhatsAppInstanceStatus }>(`/whatsapp/instances/${id}/status`),

  configureWebhook: (id: string) =>
    apiRequest<WhatsAppWebhookResult>(`/whatsapp/instances/${id}/webhook`, {
      method: 'POST',
      body: {},
    }),
};
