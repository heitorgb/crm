import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import type {
  AnalyzeSalesOpportunityInput,
  CreateSalesFollowUpInput,
  SuggestSalesReplyInput,
  TestAiConnectionInput,
  UpdateAiSettingsInput,
  UpdateSalesFollowUpInput,
  UpdateSalesRecommendationInput,
} from '@/types/ai';
import { aiService } from './services/ai-service';

export const aiKeys = {
  all: ['ai'] as const,
  catalog: ['ai', 'catalog'] as const,
  settings: (tenantId: string) => ['ai', 'settings', tenantId] as const,
};

export const salesCopilotKeys = {
  all: ['ai', 'sales-copilot'] as const,
  context: (tenantId: string, leadId: string, conversationId: string | null) =>
    ['ai', 'sales-copilot', tenantId, leadId, conversationId] as const,
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

export function useSalesCopilotContext(
  leadId: string | null,
  conversationId: string | null,
) {
  const tenantId = useAuthStore((state) => state.session?.tenant.id);

  return useQuery({
    queryKey: salesCopilotKeys.context(tenantId ?? '', leadId ?? '', conversationId),
    queryFn: () =>
      aiService.getSalesContext({
        leadId: leadId as string,
        conversationId: conversationId ?? undefined,
      }),
    enabled: Boolean(tenantId && leadId),
    staleTime: 15_000,
  });
}

export function useAnalyzeSalesOpportunity() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((state) => state.session?.tenant.id);

  return useMutation({
    mutationFn: (input: AnalyzeSalesOpportunityInput) =>
      aiService.analyzeSalesOpportunity(input),
    onSuccess: (result, input) => {
      if (tenantId) {
        queryClient.setQueryData(
          salesCopilotKeys.context(tenantId, input.leadId, input.conversationId ?? null),
          result.state,
        );
      }
    },
  });
}

export function useSuggestSalesReply() {
  return useMutation({
    mutationFn: (input: SuggestSalesReplyInput) => aiService.suggestSalesReply(input),
  });
}

export function useDecideSalesRecommendation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateSalesRecommendationInput;
    }) => aiService.decideSalesRecommendation(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesCopilotKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useCreateSalesFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSalesFollowUpInput) => aiService.createSalesFollowUp(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesCopilotKeys.all });
    },
  });
}

export function useUpdateSalesFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSalesFollowUpInput }) =>
      aiService.updateSalesFollowUp(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesCopilotKeys.all });
    },
  });
}
