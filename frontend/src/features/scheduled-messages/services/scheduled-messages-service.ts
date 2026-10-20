import { apiRequest, apiUpload } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type {
  ScheduledMessage,
  ScheduledMessageInput,
  ScheduledMessageRecipientDefinition,
  ScheduledMessageRunLog,
  ScheduledMessageStatus,
  ScheduledMessageType,
} from '@/types/scheduled-messages';

export interface ListScheduledMessagesParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: ScheduledMessageStatus | 'ALL';
  type?: ScheduledMessageType | 'ALL';
  order?: 'asc' | 'desc';
}

function buildFormData(input: ScheduledMessageInput): FormData {
  const formData = new FormData();
  formData.append('type', input.type);
  formData.append('title', input.title);
  formData.append('content', input.content);
  if (input.valor) {
    formData.append('valor', input.valor);
  }
  formData.append('recurrence', input.recurrence);
  formData.append('scheduledAt', input.scheduledAt);
  formData.append('recipientConversationIds', JSON.stringify(input.conversationIds));
  if (input.file) {
    formData.append('file', input.file);
  }
  if (input.removeAttachment) {
    formData.append('removeAttachment', 'true');
  }
  return formData;
}

export const scheduledMessagesService = {
  list: (params: ListScheduledMessagesParams) =>
    apiRequest<PageResult<ScheduledMessage>>(
      `/scheduled-messages${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        status: params.status === 'ALL' ? undefined : params.status,
        type: params.type === 'ALL' ? undefined : params.type,
        order: params.order,
      })}`,
    ),

  get: (id: string) => apiRequest<ScheduledMessage>(`/scheduled-messages/${id}`),

  create: (input: ScheduledMessageInput) =>
    apiUpload<ScheduledMessage>('/scheduled-messages', buildFormData(input)),

  update: (id: string, input: ScheduledMessageInput) =>
    apiUpload<ScheduledMessage>(
      `/scheduled-messages/${id}`,
      buildFormData(input),
      'PATCH',
    ),

  cancel: (id: string) =>
    apiRequest<ScheduledMessage>(`/scheduled-messages/${id}/cancel`, {
      method: 'POST',
      body: {},
    }),

  duplicate: (id: string, scheduledAt?: string) =>
    apiRequest<ScheduledMessage>(`/scheduled-messages/${id}/duplicate`, {
      method: 'POST',
      body: scheduledAt ? { scheduledAt } : {},
    }),

  retry: (id: string, scheduledFor?: string) =>
    apiRequest<ScheduledMessage>(`/scheduled-messages/${id}/retry`, {
      method: 'POST',
      body: scheduledFor ? { scheduledFor } : {},
    }),

  logs: (id: string) =>
    apiRequest<ScheduledMessageRunLog[]>(`/scheduled-messages/${id}/logs`),

  recipients: (id: string) =>
    apiRequest<ScheduledMessageRecipientDefinition[]>(
      `/scheduled-messages/${id}/recipients`,
    ),

  attachmentPath: (id: string) => `/scheduled-messages/${id}/attachment`,
};
