import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BillingChargeInput, BillingSettings } from '@/types/billing';
import {
  billingService,
  type ListChargesParams,
  type ListRecurrencesParams,
} from './services/billing-service';

export const billingKeys = {
  all: ['billing'] as const,
  overview: (params: { from?: string; to?: string }) => ['billing', 'overview', params] as const,
  charges: (params: ListChargesParams) => ['billing', 'charges', params] as const,
  chargeReminders: (chargeId: string) => ['billing', 'reminders', chargeId] as const,
  recurrences: (params: ListRecurrencesParams) => ['billing', 'recurrences', params] as const,
  settings: ['billing', 'settings'] as const,
};

function invalidateBilling(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: billingKeys.all });
}

export function useBillingOverview(params: { from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: billingKeys.overview(params),
    queryFn: () => billingService.overview(params),
    placeholderData: (previous) => previous,
  });
}

export function useBillingCharges(params: ListChargesParams) {
  return useQuery({
    queryKey: billingKeys.charges(params),
    queryFn: () => billingService.listCharges(params),
    placeholderData: (previous) => previous,
  });
}

export function useChargeReminders(chargeId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.chargeReminders(chargeId ?? ''),
    queryFn: () => billingService.listReminders({ chargeId, perPage: 50 }),
    enabled: Boolean(chargeId),
  });
}

export function useBillingRecurrences(params: ListRecurrencesParams = {}) {
  return useQuery({
    queryKey: billingKeys.recurrences(params),
    queryFn: () => billingService.listRecurrences(params),
    placeholderData: (previous) => previous,
  });
}

export function useBillingSettings() {
  return useQuery({
    queryKey: billingKeys.settings,
    queryFn: () => billingService.getSettings(),
  });
}

export function useCreateCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BillingChargeInput) => billingService.createCharge(input),
    onSuccess: () => invalidateBilling(queryClient),
  });
}

export function useUpdateCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<BillingChargeInput> }) =>
      billingService.updateCharge(id, input),
    onSuccess: () => invalidateBilling(queryClient),
  });
}

export function usePayCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => billingService.payCharge(id),
    onSuccess: () => invalidateBilling(queryClient),
  });
}

export function useCancelCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => billingService.cancelCharge(id),
    onSuccess: () => invalidateBilling(queryClient),
  });
}

export function useDeactivateRecurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => billingService.deactivateRecurrence(id),
    onSuccess: () => invalidateBilling(queryClient),
  });
}

export function useUpdateBillingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<BillingSettings>) => billingService.updateSettings(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(billingKeys.settings, settings);
      invalidateBilling(queryClient);
    },
  });
}
