import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebhookIntegrationInput } from '@/types/webhooks';
import {
  webhooksService,
  type ListWebhookExecutionsParams,
  type ListWebhooksParams,
} from './services/webhooks-service';

export const webhooksKeys = {
  all: ['webhook-integrations'] as const,
  list: (params: ListWebhooksParams) => ['webhook-integrations', 'list', params] as const,
  executions: (id: string, params: ListWebhookExecutionsParams) =>
    ['webhook-integrations', 'executions', id, params] as const,
  groups: (instanceId: string) =>
    ['webhook-integrations', 'groups', instanceId] as const,
};

export function useWebhooks(params: ListWebhooksParams = {}) {
  return useQuery({
    queryKey: webhooksKeys.list(params),
    queryFn: () => webhooksService.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WebhookIntegrationInput) => webhooksService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhooksKeys.all }),
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<WebhookIntegrationInput> }) =>
      webhooksService.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhooksKeys.all }),
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => webhooksService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhooksKeys.all }),
  });
}

export function useRegenerateWebhookSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => webhooksService.regenerateSecret(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhooksKeys.all }),
  });
}

export function useWebhookGroups(instanceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: webhooksKeys.groups(instanceId ?? ''),
    queryFn: () => webhooksService.listGroups(instanceId as string),
    enabled: Boolean(instanceId) && enabled,
    staleTime: 60_000,
  });
}

export function useWebhookExecutions(id: string | undefined, params: ListWebhookExecutionsParams) {
  return useQuery({
    queryKey: webhooksKeys.executions(id ?? '', params),
    queryFn: () => webhooksService.listExecutions(id as string, params),
    enabled: Boolean(id),
    placeholderData: (previous) => previous,
  });
}
