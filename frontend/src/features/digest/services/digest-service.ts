import { apiRequest } from '@/lib/api-client';
import { toQueryString } from '@/lib/query-params';
import type { PageResult } from '@/types/crm';
import type {
  DigestChannel,
  DigestDelivery,
  DigestOverview,
  DigestPreference,
} from '@/types/attendance';

export interface UpsertDigestPreferenceInput {
  enabled?: boolean;
  deliveryTime: string;
  timeZone: string;
  channel?: DigestChannel;
  whatsappDestination?: string | null;
  includeOnlyAssigned?: boolean;
}

export interface ListDigestDeliveriesParams {
  page?: number;
  perPage?: number;
  onlyFailed?: boolean;
}

export const digestService = {
  getPreference: () => apiRequest<DigestPreference | null>('/settings/lead-digest/preference'),

  upsertPreference: (input: UpsertDigestPreferenceInput) =>
    apiRequest<DigestPreference>('/settings/lead-digest/preference', {
      method: 'PUT',
      body: input,
    }),

  listDeliveries: (params: ListDigestDeliveriesParams = {}) =>
    apiRequest<PageResult<DigestDelivery>>(
      `/settings/lead-digest/deliveries${toQueryString({
        page: params.page,
        perPage: params.perPage,
        onlyFailed: params.onlyFailed,
      })}`,
    ),

  overview: () => apiRequest<DigestOverview>('/settings/lead-digest/overview'),

  run: () => apiRequest<{ ok: true }>('/settings/lead-digest/run', { method: 'POST', body: {} }),
};
