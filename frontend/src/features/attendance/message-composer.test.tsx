// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageComposer } from './message-composer';
import {
  useLinkPreview,
  useSendConversationMedia,
  useSendConversationMessage,
} from './queries';

vi.mock('./queries', () => ({
  useLinkPreview: vi.fn(),
  useSendConversationMessage: vi.fn(),
  useSendConversationMedia: vi.fn(),
}));

vi.mock('./use-audio-recorder', () => ({
  useAudioRecorder: () => ({
    recording: false,
    seconds: 0,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock('@/features/quick-replies/queries', () => ({
  useQuickReplies: () => ({
    data: {
      data: [
        {
          id: 'quick-reply-1',
          title: 'Boas-vindas',
          content: 'Olá! Como podemos ajudar?',
          createdAt: '2026-10-20T10:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z',
        },
        {
          id: 'quick-reply-2',
          title: 'Horário de funcionamento',
          content: 'Atendemos de segunda a sexta, das 8h às 18h.',
          createdAt: '2026-10-20T10:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z',
        },
      ],
      meta: { page: 1, perPage: 100, total: 2, totalPages: 1 },
    },
    isPending: false,
    isError: false,
  }),
}));

const PREVIEW = {
  url: 'https://exemplo.com/artigo',
  title: 'Título da página',
  description: 'Descrição resumida.',
  imageUrl: null,
  siteName: 'Exemplo',
  domain: 'exemplo.com',
};

let sendMessageMutate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  sendMessageMutate = vi.fn().mockResolvedValue(undefined);
  vi.mocked(useLinkPreview).mockReturnValue({
    data: PREVIEW,
    isLoading: false,
    isError: false,
  } as never);
  vi.mocked(useSendConversationMessage).mockReturnValue({
    isPending: false,
    mutateAsync: sendMessageMutate,
  } as never);
  vi.mocked(useSendConversationMedia).mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  } as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderComposer() {
  return render(
    <MessageComposer conversationId="conversation-1" replyTo={null} onCancelReply={vi.fn()} />,
  );
}

async function typeUrl(value: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('Mensagem'), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
}

describe('MessageComposer link preview', () => {
  it('shows the preview after the debounce and sends with preview enabled', async () => {
    renderComposer();
    await typeUrl('Veja https://exemplo.com/artigo');

    expect(screen.getByText('Título da página')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Enviar mensagem'));

    expect(sendMessageMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Veja https://exemplo.com/artigo',
        linkPreview: true,
      }),
    );
  });

  it('removes the preview and suppresses it when sending', async () => {
    renderComposer();
    await typeUrl('Veja https://exemplo.com/artigo');

    fireEvent.click(screen.getByLabelText('Remover pré-visualização do link'));

    expect(screen.queryByText('Título da página')).toBeNull();

    fireEvent.click(screen.getByLabelText('Enviar mensagem'));

    expect(sendMessageMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Veja https://exemplo.com/artigo',
        linkPreview: false,
      }),
    );
  });

  it('does not render or query a preview when there is no URL', async () => {
    renderComposer();
    fireEvent.change(screen.getByPlaceholderText('Mensagem'), {
      target: { value: 'Olá, tudo bem?' },
    });
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(useLinkPreview).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Remover pré-visualização do link')).toBeNull();
  });
});

describe('MessageComposer quick replies', () => {
  it('filters quick replies by the text after the slash and inserts the selected one', () => {
    renderComposer();
    const textarea = screen.getByPlaceholderText('Mensagem');

    fireEvent.change(textarea, { target: { value: '/' } });
    expect(screen.getByRole('listbox', { name: 'Respostas rápidas' })).toBeTruthy();
    expect(screen.getByText('Boas-vindas')).toBeTruthy();
    expect(screen.getByText('Horário de funcionamento')).toBeTruthy();

    fireEvent.change(textarea, { target: { value: '/boas' } });
    expect(screen.queryByText('Horário de funcionamento')).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: /Boas-vindas/ }));

    expect((textarea as HTMLTextAreaElement).value).toBe('Olá! Como podemos ajudar?');
    expect(screen.queryByRole('listbox', { name: 'Respostas rápidas' })).toBeNull();
  });

  it('supports keyboard navigation and inserts with Enter', () => {
    renderComposer();
    const textarea = screen.getByPlaceholderText('Mensagem');

    fireEvent.change(textarea, { target: { value: '/' } });
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect((textarea as HTMLTextAreaElement).value).toBe(
      'Atendemos de segunda a sexta, das 8h às 18h.',
    );
    expect(sendMessageMutate).not.toHaveBeenCalled();
  });
});
