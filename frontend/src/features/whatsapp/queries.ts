import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WhatsAppInstanceInput, WhatsAppInstanceUpdateInput } from '@/types/whatsapp';
import {
  whatsappService,
  type ListWhatsAppInstancesParams,
} from './services/whatsapp-service';

export const whatsappKeys = {
  all: ['whatsapp-instances'] as const,
  list: (params: ListWhatsAppInstancesParams) => ['whatsapp-instances', 'list', params] as const,
  status: (id: string) => ['whatsapp-instances', 'status', id] as const,
};

export function useWhatsAppInstances(params: ListWhatsAppInstancesParams = {}) {
  return useQuery({
    queryKey: whatsappKeys.list(params),
    queryFn: () => whatsappService.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useWhatsAppInstanceStatus(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: whatsappKeys.status(id ?? ''),
    queryFn: () => whatsappService.status(id as string),
    enabled: Boolean(id) && enabled,
    refetchInterval: enabled ? 3000 : false,
  });
}

export function useCreateWhatsAppInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WhatsAppInstanceInput) => whatsappService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: whatsappKeys.all }),
  });
}

export function useUpdateWhatsAppInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: WhatsAppInstanceUpdateInput }) =>
      whatsappService.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: whatsappKeys.all }),
  });
}

export function useDeleteWhatsAppInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => whatsappService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: whatsappKeys.all }),
  });
}

export function useConnectWhatsAppInstance() {
  return useMutation({
    mutationFn: (id: string) => whatsappService.connect(id),
  });
}

export function useDisconnectWhatsAppInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => whatsappService.disconnect(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: whatsappKeys.all }),
  });
}

export function useConfigureWhatsAppWebhook() {
  return useMutation({
    mutationFn: (id: string) => whatsappService.configureWebhook(id),
  });
}
