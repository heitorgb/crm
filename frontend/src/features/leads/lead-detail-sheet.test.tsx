// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types/attendance';
import type { LeadCard, LeadPipeline } from '@/types/crm';
import { LeadDetailSheet } from './lead-detail-sheet';
import {
  useCloseConversation,
  useConversation,
  useConversationHistoryMessages,
  useConversationMessages,
  useConversations,
  useMarkConversationRead,
  useRefreshGroup,
  useTakeoverConversation,
} from '@/features/attendance/queries';

vi.mock('@/features/attendance/queries', () => ({
  useCloseConversation: vi.fn(),
  useConversation: vi.fn(),
  useConversationHistoryMessages: vi.fn(),
  useConversationMessages: vi.fn(),
  useConversations: vi.fn(),
  useMarkConversationRead: vi.fn(),
  useRefreshGroup: vi.fn(),
  useTakeoverConversation: vi.fn(),
}));

vi.mock('@/features/attendance/chat-panel', () => ({
  ChatPanel: ({ conversation }: { conversation: Conversation }) => <div>Chat de {conversation.contactName}</div>,
}));

vi.mock('@/features/attendance/start-conversation-dialog', () => ({
  StartConversationDialog: () => null,
}));

vi.mock('@/features/ai/sales-copilot-panel', () => ({
  SalesCopilotPanel: () => <div>Copiloto comercial</div>,
}));

const pipeline: LeadPipeline = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Pipeline comercial',
  description: null,
  active: true,
  stages: [
    { id: '22222222-2222-4222-8222-222222222222', pipelineId: '11111111-1111-4111-8111-111111111111', name: 'Novo lead', color: '#3b82f6', position: 1, kind: 'OPEN' },
    { id: '33333333-3333-4333-8333-333333333333', pipelineId: '11111111-1111-4111-8111-111111111111', name: 'Pagamento', color: '#f97316', position: 2, kind: 'OPEN' },
  ],
};

const lead: LeadCard = {
  id: '44444444-4444-4444-8444-444444444444',
  pipelineId: pipeline.id,
  stageId: pipeline.stages[1].id,
  contactId: '55555555-5555-4555-8555-555555555555',
  ownerId: null,
  ownerName: null,
  title: 'Plano mensal',
  source: 'WhatsApp',
  valueCents: 15000,
  status: 'OPEN',
  notes: 'Cliente pediu retorno.',
  nextFollowUpAt: null,
  closedAt: null,
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
  tags: [],
  contact: { id: '55555555-5555-4555-8555-555555555555', name: 'Ana', phone: '5511999999999', email: null, avatarUrl: null },
};

const conversation: Conversation = {
  id: '66666666-6666-4666-8666-666666666666',
  status: 'OPEN',
  subject: null,
  isGroup: false,
  groupName: null,
  avatarUrl: null,
  isPinned: false,
  isArchived: false,
  unreadCount: 0,
  whatsappInstanceId: '77777777-7777-4777-8777-777777777777',
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

describe('LeadDetailSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useConversations)
      .mockReturnValueOnce(queryResult({ data: [conversation], meta: { page: 1, perPage: 50, total: 1, totalPages: 1 } }))
      .mockReturnValueOnce(queryResult({ data: [], meta: { page: 1, perPage: 50, total: 0, totalPages: 0 } }));
    vi.mocked(useConversation).mockReturnValue(queryResult(conversation));
    vi.mocked(useConversationMessages).mockReturnValue(queryResult({ data: [], meta: { page: 1, perPage: 100, total: 0, totalPages: 0 } }));
    vi.mocked(useConversationHistoryMessages).mockReturnValue({ data: undefined, hasNextPage: false, isFetchingNextPage: false, isPending: false, fetchNextPage: vi.fn() } as never);
    vi.mocked(useCloseConversation).mockReturnValue(mutationResult());
    vi.mocked(useTakeoverConversation).mockReturnValue(mutationResult());
    vi.mocked(useRefreshGroup).mockReturnValue(mutationResult());
    vi.mocked(useMarkConversationRead).mockReturnValue(mutationResult());
  });

  it('shows the current pipeline stage and the contact conversation', () => {
    render(
      <MemoryRouter>
        <LeadDetailSheet open onOpenChange={vi.fn()} lead={lead} pipeline={pipeline} onEdit={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('Pagamento').length).toBeGreaterThan(0);
    expect(screen.getByText('Atual')).toBeTruthy();
    expect(screen.getByText('Chat de Ana')).toBeTruthy();
    expect(screen.getByText('Copiloto comercial')).toBeTruthy();
    expect(screen.getByText('Abrir no atendimento')).toBeTruthy();
  });
});

function queryResult<T>(data: T) {
  return { data, isPending: false, isError: false, refetch: vi.fn() } as never;
}

function mutationResult() {
  return { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() } as never;
}
