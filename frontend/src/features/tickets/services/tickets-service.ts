import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type { Ticket, TicketPriority, TicketStatus } from '@/types/attendance';

export interface ListTicketsParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string;
  unassigned?: boolean;
}

export interface TicketInput {
  subject: string;
  conversationId?: string;
  leadId?: string;
  customerId?: string;
  priority?: TicketPriority;
  assigneeId?: string;
}

export const ticketsService = {
  list: (params: ListTicketsParams = {}) =>
    apiRequest<PageResult<Ticket>>(
      `/tickets${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        status: params.status,
        priority: params.priority,
        assigneeId: params.assigneeId,
        unassigned: params.unassigned,
      })}`,
    ),

  create: (input: TicketInput) => apiRequest<Ticket>('/tickets', { method: 'POST', body: input }),

  update: (id: string, input: Partial<TicketInput> & { status?: TicketStatus }) =>
    apiRequest<Ticket>(`/tickets/${id}`, { method: 'PATCH', body: input }),
};
