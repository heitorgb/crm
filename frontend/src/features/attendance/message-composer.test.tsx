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
