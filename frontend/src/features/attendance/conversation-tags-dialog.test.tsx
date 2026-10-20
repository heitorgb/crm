// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types/attendance';
import { ConversationTagsDialog } from './conversation-tags-dialog';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries', () => ({
  useUpdateConversationTags: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }),
}));

vi.mock('@/features/tags/tag-picker', () => ({
  TagPicker: ({ onValueChange }: { onValueChange: (value: string[]) => void }) => (
    <button type="button" onClick={() => onValueChange(['tag-1'])}>
      Selecionar prioridade
    </button>
  ),
}));

const conversation: Conversation = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'OPEN',
  subject: null,
  isGroup: false,
  groupName: null,
  avatarUrl: null,
  isPinned: false,
  isArchived: false,
  unreadCount: 0,
  whatsappInstanceId: '22222222-2222-4222-8222-222222222222',
  instanceName: 'Comercial',
  externalContactId: '5511999999999@s.whatsapp.net',
  contactId: null,
  contactName: 'Ana',
  contactPhone: '5511999999999',
  customerId: null,
  customerName: null,
  lastMessageAt: null,
  lastMessage: null,
  tags: [],
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConversationTagsDialog', () => {
  it('saves the selected tags for the conversation', async () => {
    mocks.mutateAsync.mockResolvedValue(conversation);
    const onOpenChange = vi.fn();
    render(
      <ConversationTagsDialog
        conversation={conversation}
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar prioridade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        id: conversation.id,
        tagIds: ['tag-1'],
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
