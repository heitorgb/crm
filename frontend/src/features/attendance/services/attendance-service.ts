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
  archived?: boolean;
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
        archived: params.archived,
      })}`,
    ),

  getConversation: (id: string) => apiRequest<Conversation>(`/conversations/${id}`),

  unreadCount: () => apiRequest<{ total: number }>('/conversations/unread-count'),

  markRead: (id: string) =>
    apiRequest<Conversation>(`/conversations/${id}/read`, { method: 'POST', body: {} }),

  startConversation: (input: { contactId: string; whatsappInstanceId: string }) =>
    apiRequest<Conversation>('/conversations/start', { method: 'POST', body: input }),

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

  pin: (id: string) =>
    apiRequest<Conversation>(`/conversations/${id}/pin`, { method: 'POST', body: {} }),

  unpin: (id: string) =>
    apiRequest<Conversation>(`/conversations/${id}/unpin`, { method: 'POST', body: {} }),

  archive: (id: string) =>
    apiRequest<Conversation>(`/conversations/${id}/archive`, { method: 'POST', body: {} }),

  unarchive: (id: string) =>
    apiRequest<Conversation>(`/conversations/${id}/unarchive`, { method: 'POST', body: {} }),

  deleteConversation: (id: string) =>
    apiRequest<void>(`/conversations/${id}`, { method: 'DELETE' }),

  refreshGroup: (id: string) =>
    apiRequest<Conversation>(`/conversations/${id}/refresh-group`, { method: 'POST', body: {} }),

  sendMessage: (id: string, content: string, includeAgentName: boolean, quotedMessageId?: string) =>
    apiRequest<{ ok: true }>(`/conversations/${id}/messages`, {
      method: 'POST',
      body: {
        content,
        includeAgentName,
        ...(quotedMessageId ? { quotedMessageId } : {}),
      },
    }),

  sendMedia: (
    id: string,
    file: File,
    caption?: string,
    includeAgentName?: boolean,
    quotedMessageId?: string,
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (caption && caption.trim().length > 0) {
      formData.append('caption', caption.trim());
    }
    formData.append('includeAgentName', includeAgentName ? 'true' : 'false');
    if (quotedMessageId) {
      formData.append('quotedMessageId', quotedMessageId);
    }
    return apiUpload<{ ok: true }>(`/conversations/${id}/messages/media`, formData);
  },
};
