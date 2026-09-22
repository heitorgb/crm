import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QualificationProfileInput } from '@/types/qualification';
import {
  qualificationProfilesService,
  type ListQualificationProfilesParams,
} from './services/qualification-service';

export const qualificationProfileKeys = {
  all: ['qualification-profiles'] as const,
  list: (params: ListQualificationProfilesParams) =>
    ['qualification-profiles', 'list', params] as const,
  detail: (id: string) => ['qualification-profiles', 'detail', id] as const,
};

export function useQualificationProfiles(params: ListQualificationProfilesParams = {}) {
  return useQuery({
    queryKey: qualificationProfileKeys.list(params),
    queryFn: () => qualificationProfilesService.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useCreateQualificationProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: QualificationProfileInput) => qualificationProfilesService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qualificationProfileKeys.all }),
  });
}

export function useUpdateQualificationProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<QualificationProfileInput> }) =>
      qualificationProfilesService.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qualificationProfileKeys.all }),
  });
}

export function useDeleteQualificationProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => qualificationProfilesService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qualificationProfileKeys.all }),
  });
}
