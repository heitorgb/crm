// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import type { ScheduledMessage } from '@/types/scheduled-messages';
import { ScheduledMessageForm } from './scheduled-message-form';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries', () => ({
  useCreateScheduledMessage: () => ({ mutateAsync, isPending: false }),
  useUpdateScheduledMessage: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('./recipient-picker', () => ({
  RecipientPicker: () => <div>Destinatários</div>,
}));

const schedule: ScheduledMessage = {
  id: 'schedule-1',
  type: 'CAMPAIGN',
  title: 'Campanha',
  content: 'Olá, {nome}',
  valor: null,
  recurrence: 'DAILY',
  weekdays: [1, 3, 5],
  timeZone: 'America/Sao_Paulo',
  scheduledAt: '2026-10-19T12:00:00.000Z',
  nextRunAt: '2026-10-21T12:00:00.000Z',
  lastRunAt: null,
  recipientCount: 1,
  status: 'SCHEDULED',
  canceledAt: null,
  hasAttachment: false,
  attachmentFileName: null,
  attachmentMimeType: null,
  attachmentSize: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    session: {
      accessToken: 'token',
      tokenType: 'Bearer',
      expiresIn: 900,
      expiresAt: Date.now() + 900_000,
      user: {
        id: 'user-1',
        name: 'Ana Souza',
        email: 'ana@example.com',
        avatarUrl: null,
      },
      tenant: { id: 'tenant-1', name: 'OrderUp' },
      role: 'OWNER',
      membershipId: 'member-1',
    },
  });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ session: null });
});

describe('ScheduledMessageForm weekdays', () => {
  it('loads the saved weekdays when editing a daily schedule', () => {
    render(
      <ScheduledMessageForm
        open
        onOpenChange={vi.fn()}
        schedule={schedule}
        initialRecipients={[
          {
            conversationId: 'conversation-1',
            recipientName: 'Ana',
            status: 'PENDING',
          },
        ]}
      />,
    );

    expect(screen.getByText('Dias da semana')).toBeTruthy();
    expect(screen.getByText('Selecione os dias em que a mensagem será enviada.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Segunda-feira' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Terça-feira' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Sexta-feira' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('toggles a weekday selection and blocks saving when none remains', async () => {
    render(
      <ScheduledMessageForm
        open
        onOpenChange={vi.fn()}
        schedule={{ ...schedule, weekdays: [1] }}
        initialRecipients={[
          {
            conversationId: 'conversation-1',
            recipientName: 'Ana',
            status: 'PENDING',
          },
        ]}
      />,
    );

    const monday = screen.getByRole('button', { name: 'Segunda-feira' });
    fireEvent.click(monday);
    expect(monday.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    });

    expect(screen.getByText('Selecione ao menos um dia da semana.')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('does not render the weekday selector for a one-time schedule', () => {
    render(
      <ScheduledMessageForm
        open
        onOpenChange={vi.fn()}
        schedule={{ ...schedule, recurrence: 'ONCE', weekdays: [] }}
        initialRecipients={[
          {
            conversationId: 'conversation-1',
            recipientName: 'Ana',
            status: 'PENDING',
          },
        ]}
      />,
    );

    expect(screen.queryByText('Dias da semana')).toBeNull();
  });
});
