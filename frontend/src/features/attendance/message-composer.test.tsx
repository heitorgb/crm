// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageComposer } from './message-composer';
import { useAiSettings, useFormalizeMessage } from '@/features/ai/queries';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-client';
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

vi.mock('@/features/ai/queries', () => ({
  useAiSettings: vi.fn(),
  useFormalizeMessage: vi.fn(),
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
let formalizeMutate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  sendMessageMutate = vi.fn().mockResolvedValue(undefined);
  formalizeMutate = vi.fn().mockResolvedValue({ text: 'Texto reformulado.' });
  vi.mocked(useAiSettings).mockReturnValue({
    data: { available: false },
    isPending: false,
  } as never);
  vi.mocked(useFormalizeMessage).mockReturnValue({
    isPending: false,
    mutateAsync: formalizeMutate,
  } as never);
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

function composer(props: Partial<ComponentProps<typeof MessageComposer>> = {}) {
  return (
    <TooltipProvider>
      <MessageComposer
        conversationId="conversation-1"
        replyTo={null}
        onCancelReply={vi.fn()}
        {...props}
      />
    </TooltipProvider>
  );
}

function renderComposer(props: Partial<ComponentProps<typeof MessageComposer>> = {}) {
  return render(composer(props));
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


describe('MessageComposer AI formalization', () => {
  it('hides the AI button when the tenant has no usable configuration', () => {
    renderComposer();
    fireEvent.change(screen.getByPlaceholderText('Mensagem'), {
      target: { value: 'oi, tudo bem?' },
    });

    expect(screen.queryByLabelText('Formalizar mensagem com IA')).toBeNull();
  });

  it('formalizes the full composer text without sending the message', async () => {
    vi.mocked(useAiSettings).mockReturnValue({
      data: { available: true },
      isPending: false,
    } as never);
    formalizeMutate.mockResolvedValue({ text: 'Olá, tudo bem?' });

    renderComposer();
    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'oi, td bem?' } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Formalizar mensagem com IA'));
    });

    expect(formalizeMutate).toHaveBeenCalledWith('oi, td bem?');
    expect((textarea as HTMLTextAreaElement).value).toBe('Olá, tudo bem?');
    expect(sendMessageMutate).not.toHaveBeenCalled();
  });

  it('restores the exact original text when undoing the formalization', async () => {
    vi.mocked(useAiSettings).mockReturnValue({
      data: { available: true },
      isPending: false,
    } as never);
    const original = 'bom dia, preciso de ajuda com o pedido 123';
    formalizeMutate.mockResolvedValue({
      text: 'Bom dia! Preciso de ajuda com o pedido 123.',
    });

    renderComposer();
    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: original } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Formalizar mensagem com IA'));
    });

    expect((textarea as HTMLTextAreaElement).value).toBe(
      'Bom dia! Preciso de ajuda com o pedido 123.',
    );

    fireEvent.click(screen.getByLabelText('Desfazer reformulação'));

    expect((textarea as HTMLTextAreaElement).value).toBe(original);
    expect(sendMessageMutate).not.toHaveBeenCalled();
  });

  it('keeps the original text and shows a friendly error when formalization fails', async () => {
    vi.mocked(useAiSettings).mockReturnValue({
      data: { available: true },
      isPending: false,
    } as never);
    formalizeMutate.mockRejectedValue(
      new ApiError(504, 'AI_PROVIDER_TIMEOUT', 'O provedor de IA demorou demais para responder.'),
    );

    renderComposer();
    const textarea = screen.getByPlaceholderText('Mensagem');
    const original = 'mensagem original que deve permanecer';
    fireEvent.change(textarea, { target: { value: original } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Formalizar mensagem com IA'));
    });

    expect(screen.getByText('O provedor de IA demorou demais para responder.')).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe(original);
    expect(sendMessageMutate).not.toHaveBeenCalled();
  });
});


describe('MessageComposer copilot insertion', () => {
  it('inserts a suggestion into an empty composer without sending', async () => {
    const insertionHandled = vi.fn();
    const view = renderComposer();

    await act(async () => {
      view.rerender(
        composer({
          insertion: { id: 1, text: 'Claro! Quantas pessoas vão usar o sistema?' },
          onInsertionHandled: insertionHandled,
        }),
      );
    });

    expect((screen.getByPlaceholderText('Mensagem') as HTMLTextAreaElement).value).toBe(
      'Claro! Quantas pessoas vão usar o sistema?',
    );
    expect(insertionHandled).toHaveBeenCalledTimes(1);
    expect(sendMessageMutate).not.toHaveBeenCalled();
  });

  it('never overwrites an existing draft without confirmation', async () => {
    const view = renderComposer();
    const textarea = screen.getByPlaceholderText('Mensagem') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Rascunho atual' } });

    await act(async () => {
      view.rerender(composer({ insertion: { id: 2, text: 'Resposta do copiloto' } }));
    });

    expect(screen.getByText(/já tem um rascunho/)).toBeTruthy();
    expect(textarea.value).toBe('Rascunho atual');
    expect(sendMessageMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Substituir rascunho' }));

    expect(textarea.value).toBe('Resposta do copiloto');
    expect(sendMessageMutate).not.toHaveBeenCalled();
  });

  it('can append the suggestion while preserving the existing draft', async () => {
    const view = renderComposer();
    const textarea = screen.getByPlaceholderText('Mensagem') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Rascunho atual' } });

    await act(async () => {
      view.rerender(composer({ insertion: { id: 3, text: 'Resposta do copiloto' } }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Inserir ao final' }));

    expect(textarea.value).toBe('Rascunho atual\n\nResposta do copiloto');
    expect(sendMessageMutate).not.toHaveBeenCalled();
  });
});
