import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import type {
  AnalyzeSalesOpportunityInput,
  SuggestSalesReplyInput,
  TestAiConnectionInput,
  UpdateAiSettingsInput,
} from '@/types/ai';
import { aiService } from './services/ai-service';

export const aiKeys = {
  all: ['ai'] as const,
  catalog: ['ai', 'catalog'] as const,
  settings: (tenantId: string) => ['ai', 'settings', tenantId] as const,
};

export function useAiCatalog() {
  return useQuery({
    queryKey: aiKeys.catalog,
    queryFn: () => aiService.getCatalog(),
    staleTime: 60 * 60 * 1000,
  });
}

export function useAiSettings() {
  const tenantId = useAuthStore((state) => state.session?.tenant.id);

  return useQuery({
    queryKey: aiKeys.settings(tenantId ?? ''),
    queryFn: () => aiService.getSettings(),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });
}

export function useSaveAiSettings() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((state) => state.session?.tenant.id);

  return useMutation({
    mutationFn: (input: UpdateAiSettingsInput) => aiService.saveSettings(input),
    onSuccess: (settings) => {
      if (tenantId) {
        queryClient.setQueryData(aiKeys.settings(tenantId), settings);
      }
      void queryClient.invalidateQueries({ queryKey: aiKeys.all });
    },
  });
}

export function useTestAiConnection() {
  return useMutation({
    mutationFn: (input: TestAiConnectionInput) => aiService.testConnection(input),
  });
}

export function useFormalizeMessage() {
  return useMutation({
    mutationFn: (text: string) => aiService.formalize(text),
  });
}

export function useAnalyzeSalesOpportunity() {
  return useMutation({
    mutationFn: (input: AnalyzeSalesOpportunityInput) =>
      aiService.analyzeSalesOpportunity(input),
  });
}

export function useSuggestSalesReply() {
  return useMutation({
    mutationFn: (input: SuggestSalesReplyInput) => aiService.suggestSalesReply(input),
  });
}
