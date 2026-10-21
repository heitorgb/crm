// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-client';
import type { ComponentProps } from 'react';
import type { Conversation } from '@/types/attendance';
import type { SalesCopilotState } from '@/types/ai';
import type { LeadCard } from '@/types/crm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesCopilotPanel } from './sales-copilot-panel';
import {
  useAiSettings,
  useAnalyzeSalesOpportunity,
  useCreateSalesFollowUp,
  useDecideSalesRecommendation,
  useSalesCopilotContext,
  useSuggestSalesReply,
  useUpdateSalesFollowUp,
} from './queries';
import { useMembers } from '@/features/settings/queries';

vi.mock('./queries', () => ({
  useAiSettings: vi.fn(),
  useSalesCopilotContext: vi.fn(),
  useAnalyzeSalesOpportunity: vi.fn(),
  useSuggestSalesReply: vi.fn(),
  useDecideSalesRecommendation: vi.fn(),
  useCreateSalesFollowUp: vi.fn(),
  useUpdateSalesFollowUp: vi.fn(),
}));

vi.mock('@/features/settings/queries', () => ({
  useMembers: vi.fn(),
}));

const lead: LeadCard = {
  id: '11111111-1111-4111-8111-111111111111',
  pipelineId: '22222222-2222-4222-8222-222222222222',
  stageId: '33333333-3333-4333-8333-333333333333',
  contactId: '44444444-4444-4444-8444-444444444444',
  ownerId: '99999999-9999-4999-8999-999999999999',
  ownerName: 'Ana',
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

const nextAction = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  leadId: lead.id,
  conversationId: conversation.id,
  kind: 'NEXT_ACTION' as const,
  status: 'RECOMMENDED' as const,
  priority: 'HIGH' as const,
  action: 'Perguntar quantas pessoas vão usar o sistema.',
  reason: 'A quantidade de usuários ainda não foi informada.',
  expectedOutcome: 'Dimensionar a proposta.',
  missingInformation: ['Quantidade de usuários'],
  suggestedDueAt: null,
  suggestedMessage: 'Quantas pessoas vão usar o sistema?',
  updateField: null,
  proposedValue: null,
  evidence: null,
  decidedAt: null,
  decidedByName: null,
  result: {},
  beforeData: {},
  afterData: {},
  createdAt: '2026-10-20T12:30:00.000Z',
};

const updateSuggestion = {
  ...nextAction,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'LEAD_UPDATE' as const,
  priority: 'MEDIUM' as const,
  action: 'Atualizar usuários ou volume',
  reason: 'O cliente informou cinco pessoas.',
  updateField: 'USERS' as const,
  proposedValue: 'Cinco pessoas no primeiro mês.',
  evidence: 'O cliente informou cinco pessoas.',
};

const followUp = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  leadId: lead.id,
  conversationId: conversation.id,
  recommendationId: nextAction.id,
  action: nextAction.action,
  reason: nextAction.reason,
  dueAt: '2026-11-02T14:00:00.000Z',
  ownerId: lead.ownerId,
  ownerName: 'Ana',
  createdByMembershipId: lead.ownerId,
  createdByName: 'Ana',
  suggestedMessage: 'Quantas pessoas vão usar o sistema?',
  status: 'PENDING' as const,
  completedAt: null,
  canceledAt: null,
  rescheduleCount: 0,
  lastRescheduledAt: null,
  createdAt: '2026-10-20T12:40:00.000Z',
  updatedAt: '2026-10-20T12:40:00.000Z',
};

const context = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  leadId: lead.id,
  conversationId: conversation.id,
  summary: 'A cliente quer implantar o sistema.',
  objective: 'Implantar o OrderUp na loja.',
  need: 'Entender o prazo de implantação.',
  knownInformation: ['Quer implantar o sistema'],
  hypotheses: ['Hipótese: precisa de treinamento.'],
  pendingInformation: ['Quantidade de usuários'],
  nextQuestion: 'Quantas pessoas vão usar o sistema?',
  suggestedReply: 'Claro! Quantas pessoas vão usar o sistema?',
  rationale: 'A pergunta dimensiona a proposta.',
  provider: 'OPENAI' as const,
  model: 'gpt-6-luna',
  promptVersion: 'sales-copilot-v2',
  analysisVersion: 1,
  latestMessageId: 'message-3',
  latestMessageAt: '2026-10-20T12:20:00.000Z',
  leadUpdatedAt: lead.updatedAt,
  lastAnalyzedAt: '2026-10-20T12:30:00.000Z',
  createdAt: '2026-10-20T12:30:00.000Z',
  updatedAt: '2026-10-20T12:30:00.000Z',
};

const state: SalesCopilotState = {
  context,
  stale: false,
  staleReasons: [],
  nextAction,
  leadUpdateSuggestions: [updateSuggestion],
  recommendations: [
    { ...nextAction, status: 'EXECUTED' },
    { ...updateSuggestion, status: 'REJECTED', decidedAt: '2026-10-20T13:00:00.000Z' },
  ],
  followUps: [followUp],
};

let analyzeMutate: ReturnType<typeof vi.fn>;
let suggestMutate: ReturnType<typeof vi.fn>;
let decideMutate: ReturnType<typeof vi.fn>;
let createFollowUpMutate: ReturnType<typeof vi.fn>;
let updateFollowUpMutate: ReturnType<typeof vi.fn>;
let refetchContext: ReturnType<typeof vi.fn>;
let refetchSettings: ReturnType<typeof vi.fn>;
let onUseReply: (text: string, conversationId: string) => void;

beforeEach(() => {
  analyzeMutate = vi.fn().mockResolvedValue(undefined);
  suggestMutate = vi.fn().mockResolvedValue({
    reply: 'Outra resposta contextual.',
    provider: 'OPENAI',
    model: 'gpt-6-luna',
    generatedAt: '2026-10-20T12:40:00.000Z',
    promptVersion: 'sales-copilot-v2',
    context: { ...context },
  });
  decideMutate = vi.fn().mockResolvedValue(undefined);
  createFollowUpMutate = vi.fn().mockResolvedValue(undefined);
  updateFollowUpMutate = vi.fn().mockResolvedValue(undefined);
  refetchContext = vi.fn();
  refetchSettings = vi.fn();
  onUseReply = vi.fn();

  vi.mocked(useAiSettings).mockReturnValue({
    data: { available: true, enabled: true },
    isPending: false,
    isError: false,
    refetch: refetchSettings,
  } as never);
  vi.mocked(useSalesCopilotContext).mockReturnValue({
    data: state,
    isPending: false,
    isError: false,
    refetch: refetchContext,
  } as never);
  vi.mocked(useAnalyzeSalesOpportunity).mockReturnValue({
    isPending: false,
    mutateAsync: analyzeMutate,
  } as never);
  vi.mocked(useSuggestSalesReply).mockReturnValue({
    isPending: false,
    mutateAsync: suggestMutate,
  } as never);
  vi.mocked(useDecideSalesRecommendation).mockReturnValue({
    isPending: false,
    mutateAsync: decideMutate,
  } as never);
  vi.mocked(useCreateSalesFollowUp).mockReturnValue({
    isPending: false,
    mutateAsync: createFollowUpMutate,
  } as never);
  vi.mocked(useUpdateSalesFollowUp).mockReturnValue({
    isPending: false,
    mutateAsync: updateFollowUpMutate,
  } as never);
  vi.mocked(useMembers).mockReturnValue({
    data: [
      {
        id: lead.ownerId,
        userId: '88888888-8888-4888-8888-888888888888',
        name: 'Ana',
        email: 'ana@example.com',
        avatarUrl: null,
        role: 'USER',
        active: true,
      },
    ],
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
  it('shows the saved context and the next best action after reload', () => {
    renderPanel();

    expect(screen.getByText(/Contexto salvo em/)).toBeTruthy();
    expect(screen.getByText('Próxima melhor ação')).toBeTruthy();
    expect(screen.getAllByText(nextAction.action).length).toBeGreaterThan(0);
    expect(screen.getByText('Fatos confirmados')).toBeTruthy();
    expect(screen.getByText('Hipóteses da IA')).toBeTruthy();
    expect(screen.getByText('Contexto comercial salvo')).toBeTruthy();
    expect(screen.getByText('Acompanhamentos')).toBeTruthy();
    expect(screen.getByText('Histórico de recomendações e decisões')).toBeTruthy();
  });

  it('explains how to configure AI but still shows the saved context', () => {
    vi.mocked(useAiSettings).mockReturnValue({
      data: { available: false, enabled: true },
      isPending: false,
      isError: false,
      refetch: refetchSettings,
    } as never);

    renderPanel();

    expect(screen.getByText('IA não configurada')).toBeTruthy();
    expect(screen.getByText('Configurar IA')).toBeTruthy();
    expect(screen.getAllByText(nextAction.action).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Criar acompanhamento' })).toBeTruthy();
  });

  it('loads a saved context and marks it as outdated when a newer message exists', () => {
    vi.mocked(useSalesCopilotContext).mockReturnValue({
      data: { ...state, stale: true, staleReasons: ['new_messages'] },
      isPending: false,
      isError: false,
      refetch: refetchContext,
    } as never);

    renderPanel();

    expect(screen.getByText('Contexto desatualizado')).toBeTruthy();
    expect(screen.getByText(/Chegaram novas mensagens/)).toBeTruthy();
  });

  it('analyzes a lead without saved context', async () => {
    vi.mocked(useSalesCopilotContext).mockReturnValue({
      data: {
        context: null,
        stale: false,
        staleReasons: [],
        nextAction: null,
        leadUpdateSuggestions: [],
        recommendations: [],
        followUps: [],
      },
      isPending: false,
      isError: false,
      refetch: refetchContext,
    } as never);

    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analisar oportunidade' }));
    });

    expect(analyzeMutate).toHaveBeenCalledWith({
      leadId: lead.id,
      conversationId: conversation.id,
    });
  });

  it('accepts and rejects recommendations explicitly', async () => {
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
    });
    expect(decideMutate).toHaveBeenCalledWith({
      id: nextAction.id,
      input: { action: 'ACCEPT', value: undefined },
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Rejeitar' })[0]);
    });
    expect(decideMutate).toHaveBeenCalledWith({
      id: nextAction.id,
      input: { action: 'REJECT', value: undefined },
    });
  });

  it('allows editing a lead update before applying it', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Valor da atualização'), {
      target: { value: 'Oito pessoas no primeiro mês.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    });

    expect(decideMutate).toHaveBeenCalledWith({
      id: updateSuggestion.id,
      input: { action: 'ACCEPT', value: 'Oito pessoas no primeiro mês.' },
    });
  });

  it('rejects a lead update without changing the lead locally', async () => {
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Rejeitar' })[1]);
    });

    expect(decideMutate).toHaveBeenCalledWith({
      id: updateSuggestion.id,
      input: { action: 'REJECT', value: undefined },
    });
  });

  it('creates a follow-up only after the confirmation dialog', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Criar acompanhamento' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Novo acompanhamento')).toBeTruthy();
    expect(createFollowUpMutate).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Criar acompanhamento' }));
    });

    expect(createFollowUpMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: lead.id,
        conversationId: conversation.id,
        recommendationId: nextAction.id,
        action: nextAction.action,
        idempotencyKey: expect.any(String),
      }),
    );
    expect(onUseReply).not.toHaveBeenCalled();
  });

  it('completes and reschedules a follow-up', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    fireEvent.change(screen.getByLabelText('Resultado do acompanhamento'), {
      target: { value: 'Cliente confirmou a reunião.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar conclusão' }));
    });
    expect(updateFollowUpMutate).toHaveBeenCalledWith({
      id: followUp.id,
      input: { status: 'COMPLETED', result: 'Cliente confirmou a reunião.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    fireEvent.change(screen.getByLabelText('Nova data do acompanhamento'), {
      target: { value: '2026-11-03T15:00' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar nova data' }));
    });
    expect(updateFollowUpMutate).toHaveBeenCalledWith({
      id: followUp.id,
      input: { dueAt: expect.any(String) },
    });
  });

  it('inserts the selected reply without sending it', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Usar resposta' }));

    expect(onUseReply).toHaveBeenCalledWith(context.suggestedReply, conversation.id);
  });

  it('shows the recommendation history and errors', async () => {
    analyzeMutate.mockRejectedValue(
      new ApiError(504, 'AI_PROVIDER_TIMEOUT', 'O provedor de IA demorou demais para responder.'),
    );
    vi.mocked(useSalesCopilotContext).mockReturnValue({
      data: {
        context: null,
        stale: false,
        staleReasons: [],
        nextAction: null,
        leadUpdateSuggestions: [],
        recommendations: [],
        followUps: [],
      },
      isPending: false,
      isError: false,
      refetch: refetchContext,
    } as never);
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analisar oportunidade' }));
    });

    expect(screen.getByText('O provedor de IA demorou demais para responder.')).toBeTruthy();
  });
});
