import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerKeys } from '@/features/customers/queries';
import type { ContactInput } from '@/types/crm';
import { contactsService, type ListContactsParams } from './services/contacts-service';

export const contactKeys = {
  all: ['contacts'] as const,
  list: (params: ListContactsParams) => ['contacts', 'list', params] as const,
  detail: (id: string) => ['contacts', 'detail', id] as const,
};

export function useContacts(params: ListContactsParams) {
  return useQuery({
    queryKey: contactKeys.list(params),
    queryFn: () => contactsService.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: contactKeys.detail(id ?? ''),
    queryFn: () => contactsService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ContactInput) => contactsService.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ContactInput> }) =>
      contactsService.update(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => contactsService.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}
