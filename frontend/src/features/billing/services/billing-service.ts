import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type {
  BillingCharge,
  BillingChargeInput,
  BillingOverview,
  BillingRecurrence,
  BillingRecurrenceInput,
  BillingReminder,
  BillingReminderStatus,
  BillingSettings,
} from '@/types/billing';

export interface ListChargesParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: string;
  customerId?: string;
  recurrenceId?: string;
  dueFrom?: string;
  dueTo?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface ListRemindersParams {
  page?: number;
  perPage?: number;
  status?: BillingReminderStatus;
  chargeId?: string;
}

export interface ListRecurrencesParams {
  page?: number;
  perPage?: number;
  customerId?: string;
  active?: boolean;
  search?: string;
}

export const billingService = {
  overview: (params: { from?: string; to?: string } = {}) =>
    apiRequest<BillingOverview>(
      `/billing/overview${toQueryString({ from: params.from, to: params.to })}`,
    ),

  listCharges: (params: ListChargesParams) =>
    apiRequest<PageResult<BillingCharge>>(
      `/billing/charges${toQueryString({
        page: params.page,
        perPage: params.perPage,
        search: params.search,
        status: params.status,
        customerId: params.customerId,
        recurrenceId: params.recurrenceId,
        dueFrom: params.dueFrom,
        dueTo: params.dueTo,
        sort: params.sort,
        order: params.order,
      })}`,
    ),

  getCharge: (id: string) => apiRequest<BillingCharge>(`/billing/charges/${id}`),

  createCharge: (input: BillingChargeInput) =>
    apiRequest<BillingCharge>('/billing/charges', { method: 'POST', body: input }),

  updateCharge: (id: string, input: Partial<BillingChargeInput>) =>
    apiRequest<BillingCharge>(`/billing/charges/${id}`, { method: 'PATCH', body: input }),

  payCharge: (id: string) =>
    apiRequest<BillingCharge>(`/billing/charges/${id}/pay`, { method: 'POST', body: {} }),

  cancelCharge: (id: string) =>
    apiRequest<BillingCharge>(`/billing/charges/${id}/cancel`, { method: 'POST', body: {} }),

  sendManualReminder: (chargeId: string, idempotencyKey: string) =>
    apiRequest<BillingReminder>(`/billing/charges/${chargeId}/reminders`, {
      method: 'POST',
      body: { idempotencyKey },
    }),

  listReminders: (params: ListRemindersParams) =>
    apiRequest<PageResult<BillingReminder>>(
      `/billing/reminders${toQueryString({
        page: params.page,
        perPage: params.perPage,
        status: params.status,
        chargeId: params.chargeId,
      })}`,
    ),

  listRecurrences: (params: ListRecurrencesParams = {}) =>
    apiRequest<PageResult<BillingRecurrence>>(
      `/billing/recurrences${toQueryString({
        page: params.page,
        perPage: params.perPage,
        customerId: params.customerId,
        active: params.active,
        search: params.search,
      })}`,
    ),

  deactivateRecurrence: (id: string) =>
    apiRequest<BillingRecurrence>(`/billing/recurrences/${id}`, { method: 'DELETE' }),

  createRecurrence: (input: BillingRecurrenceInput) =>
    apiRequest<BillingRecurrence>('/billing/recurrences', { method: 'POST', body: input }),

  getSettings: () => apiRequest<BillingSettings>('/billing/settings'),

  updateSettings: (input: Partial<BillingSettings>) =>
    apiRequest<BillingSettings>('/billing/settings', { method: 'PATCH', body: input }),
};
