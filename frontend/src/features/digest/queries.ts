import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  digestService,
  type ListDigestDeliveriesParams,
  type UpsertDigestPreferenceInput,
} from './services/digest-service';

export const digestKeys = {
  all: ['lead-digest'] as const,
  preference: ['lead-digest', 'preference'] as const,
  deliveries: (params: ListDigestDeliveriesParams) => ['lead-digest', 'deliveries', params] as const,
  overview: ['lead-digest', 'overview'] as const,
};

export function useDigestPreference() {
  return useQuery({
    queryKey: digestKeys.preference,
    queryFn: () => digestService.getPreference(),
  });
}

export function useDigestDeliveries(params: ListDigestDeliveriesParams = {}) {
  return useQuery({
    queryKey: digestKeys.deliveries(params),
    queryFn: () => digestService.listDeliveries(params),
    placeholderData: (previous) => previous,
  });
}

export function useDigestOverview() {
  return useQuery({
    queryKey: digestKeys.overview,
    queryFn: () => digestService.overview(),
    refetchInterval: 30000,
  });
}

export function useUpsertDigestPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertDigestPreferenceInput) => digestService.upsertPreference(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: digestKeys.all }),
  });
}

export function useRunDigest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => digestService.run(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: digestKeys.all }),
  });
}
