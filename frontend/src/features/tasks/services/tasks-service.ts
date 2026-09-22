import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type { Task, TaskInput, TaskPriority, TaskStatus } from '@/types/sales';

export interface ListTasksParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  ownerId?: string;
  leadId?: string;
  dealId?: string;
  customerId?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const tasksService = {
  list: (params: ListTasksParams = {}) =>
    apiRequest<PageResult<Task>>(
      `/tasks${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        status: params.status,
        priority: params.priority,
        ownerId: params.ownerId,
        leadId: params.leadId,
        dealId: params.dealId,
        customerId: params.customerId,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  get: (id: string) => apiRequest<Task>(`/tasks/${id}`),

  create: (input: TaskInput) => apiRequest<Task>('/tasks', { method: 'POST', body: input }),

  update: (id: string, input: Partial<TaskInput>) =>
    apiRequest<Task>(`/tasks/${id}`, { method: 'PATCH', body: input }),

  remove: (id: string) => apiRequest<void>(`/tasks/${id}`, { method: 'DELETE' }),
};
