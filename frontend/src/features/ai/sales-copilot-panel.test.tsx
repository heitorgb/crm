// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-client';
import type { Conversation } from '@/types/attendance';
import type { LeadCard } from '@/types/crm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesCopilotPanel } from './sales-copilot-panel';
import {
  useAiSettings,
  useAnalyzeSalesOpportunity,
  useSuggestSalesReply,
} from './queries';

vi.mock('./queries', () => ({
  useAiSettings: vi.fn(),
  useAnalyzeSalesOpportunity: vi.fn(),
  useSuggestSalesReply: vi.fn(),
}));

const lead: LeadCard = {
  id: '11111111-1111-4111-8111-111111111111',
  pipelineId: '22222222-2222-4222-8222-222222222222',
  stageId: '33333333-3333-4333-8333-333333333333',
  contactId: '44444444-4444-4444-8444-444444444444',
  ownerId: null,
  ownerName: null,
  title: 'Implantação OrderUp',
  source: 'WhatsApp',
  valueCents: 250000,
  status: 'OPEN',
  notes: null,
  nextFollowUpAt: null,
  closedAt: null,
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
  tags: [],
  contact: {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Ana',
    phone: '5511999999999',
    email: null,
    avatarUrl: null,
  },
};

const conversation: Conversation = {
  id: '55555555-5555-4555-8555-555555555555',
  status: 'OPEN',
  subject: null,
  isGroup: false,
  groupName: null,
  avatarUrl: null,
  isPinned: false,
  isArchived: false,
  unreadCount: 0,
  whatsappInstanceId: '66666666-6666-4666-8666-666666666666',
  instanceName: 'Comercial',
  externalContactId: '5511999999999@s.whatsapp.net',
  contactId: lead.contactId,
  contactName: 'Ana',
  contactPhone: '5511999999999',
  customerId: null,
  customerName: null,
  lastMessageAt: '2026-10-20T12:00:00.000Z',
  lastMessage: null,
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
};

const analysis = {
  summary: 'A cliente quer implantar o sistema.',
  need: 'Entender o prazo de implantação.',
  knownInformation: ['Quer implantar o sistema'],
  pendingInformation: ['Quantidade de usuários'],
  nextQuestion: 'Quantas pessoas vão usar o sistema?',
  suggestedReply: 'Claro! Quantas pessoas vão usar o sistema?',
  rationale: 'A pergunta dimensiona a proposta.',
  provider: 'OPENAI' as const,
  model: 'gpt-6-luna',
  generatedAt: '2026-10-20T12:30:00.000Z',
  promptVersion: 'sales-copilot-v1',
  context: {
    leadId: lead.id,
    conversationId: conversation.id,
    messageCount: 3,
    latestMessageId: 'message-3',
    latestMessageAt: '2026-10-20T12:20:00.000Z',
    leadUpdatedAt: lead.updatedAt,
    historyTruncated: false,
    mediaWithoutText: 0,
  },
};

let analyzeMutate: ReturnType<typeof vi.fn>;
let suggestMutate: ReturnType<typeof vi.fn>;
let refetchSettings: ReturnType<typeof vi.fn>;
let onUseReply: (text: string, conversationId: string) => void;

beforeEach(() => {
  analyzeMutate = vi.fn().mockResolvedValue(analysis);
  suggestMutate = vi.fn().mockResolvedValue({
    reply: 'Outra resposta contextual.',
    provider: 'OPENAI',
    model: 'gpt-6-luna',
    generatedAt: '2026-10-20T12:40:00.000Z',
    promptVersion: 'sales-copilot-v1',
    context: { ...analysis.context },
  });
  refetchSettings = vi.fn();
  onUseReply = vi.fn();

  vi.mocked(useAiSettings).mockReturnValue({
    data: { available: true, enabled: true },
    isPending: false,
    isError: false,
    refetch: refetchSettings,
  } as never);
  vi.mocked(useAnalyzeSalesOpportunity).mockReturnValue({
    isPending: false,
    mutateAsync: analyzeMutate,
  } as never);
  vi.mocked(useSuggestSalesReply).mockReturnValue({
    isPending: false,
    mutateAsync: suggestMutate,
  } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function panel(props: Partial<ComponentProps<typeof SalesCopilotPanel>> = {}) {
  return (
    <MemoryRouter>
      <TooltipProvider>
        <SalesCopilotPanel
          lead={lead}
          conversation={conversation}
          conversationId={conversation.id}
          latestMessageId="message-3"
          onUseReply={onUseReply}
          {...props}
        />
      </TooltipProvider>
    </MemoryRouter>
  );
}

function renderPanel(props: Partial<ComponentProps<typeof SalesCopilotPanel>> = {}) {
  return render(panel(props));
}

describe('SalesCopilotPanel', () => {
  it('explains how to configure AI when it is not available', () => {
    vi.mocked(useAiSettings).mockReturnValue({
      data: { available: false, enabled: true },
      isPending: false,
      isError: false,
      refetch: refetchSettings,
    } as never);

    renderPanel();

    expect(screen.getByText('IA não configurada')).toBeTruthy();
    expect(screen.getByText('Configurar IA')).toBeTruthy();
    expect(screen.queryByText('Analisar oportunidade')).toBeNull();
  });

  it('shows a friendly message when AI is disabled for the organization', () => {
    vi.mocked(useAiSettings).mockReturnValue({
      data: { available: false, enabled: false },
      isPending: false,
      isError: false,
      refetch: refetchSettings,
    } as never);

    renderPanel();

    expect(screen.getByText(/A IA está desativada/)).toBeTruthy();
  });

  it('analyzes the selected opportunity and conversation', async () => {
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analisar oportunidade' }));
    });

    expect(analyzeMutate).toHaveBeenCalledWith({
      leadId: lead.id,
      conversationId: conversation.id,
    });
    expect(screen.getByText('Resumo da oportunidade')).toBeTruthy();
    expect(screen.getByText(analysis.summary)).toBeTruthy();
    expect(screen.getByText('Necessidade identificada')).toBeTruthy();
    expect(screen.getByText('Informações conhecidas')).toBeTruthy();
    expect(screen.getByText('Informações pendentes')).toBeTruthy();
    expect(screen.getByText('Próxima pergunta recomendada')).toBeTruthy();
    expect(screen.getByText('Resposta sugerida')).toBeTruthy();
  });

  it('marks the analysis as outdated when the latest message changes', async () => {
    const view = renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analisar oportunidade' }));
    });

    expect(screen.queryByText('Contexto desatualizado')).toBeNull();

    view.rerender(panel({ latestMessageId: 'message-4' }));
    expect(screen.getByText('Contexto desatualizado')).toBeTruthy();
  });

  it('explains when there is no message history', async () => {
    analyzeMutate.mockResolvedValue({
      ...analysis,
      context: {
        ...analysis.context,
        conversationId: null,
        messageCount: 0,
        latestMessageId: null,
        latestMessageAt: null,
      },
    });

    renderPanel({ conversation: null, conversationId: null, latestMessageId: null });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analisar oportunidade' }));
    });

    expect(screen.getByText(/Não há histórico de mensagens suficiente/)).toBeTruthy();
    expect(screen.getByText(/Nenhuma conversa selecionada/)).toBeTruthy();
  });

  it('keeps the current reply and offers a new suggestion separately', async () => {
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analisar oportunidade' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gerar outra' }));
    });

    expect(screen.getByText(analysis.suggestedReply)).toBeTruthy();
    expect(screen.getByText('Nova sugestão')).toBeTruthy();
    expect(screen.getByText('Outra resposta contextual.')).toBeTruthy();
    expect(suggestMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: lead.id,
        conversationId: conversation.id,
        previousAnalysis: expect.stringContaining(analysis.summary),
      }),
    );
  });

  it('suggests a reply without requiring a previous analysis', async () => {
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sugerir resposta' }));
    });

    expect(suggestMutate).toHaveBeenCalledWith({
      leadId: lead.id,
      conversationId: conversation.id,
      previousAnalysis: undefined,
    });
    expect(screen.getByText('Resposta sugerida')).toBeTruthy();
    expect(screen.getByText('Outra resposta contextual.')).toBeTruthy();
    expect(screen.queryByText('Resumo da oportunidade')).toBeNull();
  });

  it('inserts the selected reply without sending it', async () => {
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analisar oportunidade' }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Usar resposta' }));

    expect(onUseReply).toHaveBeenCalledWith(analysis.suggestedReply, conversation.id);
  });

  it('disables a suggestion generated for another conversation', async () => {
    const view = renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analisar oportunidade' }));
    });

    view.rerender(
      panel({
        conversation: { ...conversation, id: '77777777-7777-4777-8777-777777777777' },
        conversationId: '77777777-7777-4777-8777-777777777777',
      }),
    );

    const useButton = screen.getByRole('button', { name: 'Usar resposta' }) as HTMLButtonElement;
    expect(useButton.disabled).toBe(true);
    fireEvent.click(useButton);

    expect(onUseReply).not.toHaveBeenCalled();
  });

  it('shows loading and error states', async () => {
    vi.mocked(useAnalyzeSalesOpportunity).mockReturnValue({
      isPending: true,
      mutateAsync: analyzeMutate,
    } as never);
    renderPanel();
    expect((screen.getByRole('button', { name: 'Analisando...' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    analyzeMutate.mockRejectedValue(
      new ApiError(504, 'AI_PROVIDER_TIMEOUT', 'O provedor de IA demorou demais para responder.'),
    );
    vi.mocked(useAnalyzeSalesOpportunity).mockReturnValue({
      isPending: false,
      mutateAsync: analyzeMutate,
    } as never);
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analisar oportunidade' }));
    });

    expect(screen.getByText('O provedor de IA demorou demais para responder.')).toBeTruthy();
  });
});
