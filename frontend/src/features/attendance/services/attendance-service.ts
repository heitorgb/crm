import { apiRequest, apiUpload } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type { Conversation, ConversationMessage, ConversationStatus } from '@/types/attendance';

export function attachmentPath(
  conversationId: string,
  messageId: string,
  attachmentId: string,
  variant: 'main' | 'thumb' = 'main',
): string {
  const query = variant === 'thumb' ? '?variant=thumb' : '';
  return `/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}${query}`;
}

export interface ListConversationsParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: ConversationStatus;
  whatsappInstanceId?: string;
  contactId?: string;
  customerId?: string;
}

export const attendanceService = {
  listConversations: (params: ListConversationsParams = {}) =>
    apiRequest<PageResult<Conversation>>(
      `/conversations${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        status: params.status,
        whatsappInstanceId: params.whatsappInstanceId,
        contactId: params.contactId,
        customerId: params.customerId,
      })}`,
    ),

  getConversation: (id: string) => apiRequest<Conversation>(`/conversations/${id}`),

  resolveParticipantAvatar: (id: string, jid: string) =>
    apiRequest<{ url: string | null }>(
      `/conversations/${id}/participant-avatar${toQueryString({ jid })}`,
    ),

  listMessages: (id: string, page = 1, perPage = 50) =>
    apiRequest<PageResult<ConversationMessage>>(
      `/conversations/${id}/messages${toQueryString({ page, perPage })}`,
    ),

  takeover: (id: string) =>
    apiRequest<Conversation>(`/conversations/${id}/takeover`, { method: 'POST', body: {} }),

  close: (id: string) =>
    apiRequest<Conversation>(`/conversations/${id}/close`, { method: 'POST', body: {} }),

  refreshGroup: (id: string) =>
    apiRequest<Conversation>(`/conversations/${id}/refresh-group`, { method: 'POST', body: {} }),

  sendMessage: (id: string, content: string) =>
    apiRequest<{ ok: true }>(`/conversations/${id}/messages`, {
      method: 'POST',
      body: { content },
    }),

  sendMedia: (id: string, file: File, caption?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (caption && caption.trim().length > 0) {
      formData.append('caption', caption.trim());
    }
    return apiUpload<{ ok: true }>(`/conversations/${id}/messages/media`, formData);
  },
};
