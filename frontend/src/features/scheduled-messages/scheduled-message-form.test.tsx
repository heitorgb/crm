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

const recipients = [
  {
    conversationId: 'conversation-1',
    recipientName: 'Ana',
    status: 'PENDING' as const,
  },
];

const schedule: ScheduledMessage = {
  id: 'schedule-1',
  type: 'CAMPAIGN',
  title: 'Campanha',
  content: 'Olá, {nome}',
  valor: null,
  recurrence: 'DAILY',
  weekdays: [1, 3, 5],
  dayOfMonth: null,
  recurringTime: '09:00',
  timeZone: 'America/Sao_Paulo',
  scheduledAt: '2099-10-19T12:00:00.000Z',
  nextRunAt: '2099-10-21T12:00:00.000Z',
  lastRunAt: null,
  recipientCount: 1,
  status: 'SCHEDULED',
  canceledAt: null,
  hasAttachment: false,
  attachmentFileName: null,
  attachmentMimeType: null,
  attachmentSize: null,
  createdAt: '2099-10-01T12:00:00.000Z',
  updatedAt: '2099-10-01T12:00:00.000Z',
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

function openRecurrenceSelect(): void {
  const trigger = screen.getAllByRole('combobox')[1];
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

function chooseRecurrence(label: string): void {
  openRecurrenceSelect();
  fireEvent.click(screen.getByRole('option', { name: label }));
}

function renderForm(existing?: ScheduledMessage): void {
  render(
    <ScheduledMessageForm
      open
      onOpenChange={vi.fn()}
      schedule={existing}
      initialRecipients={recipients}
    />,
  );
}

function fillRequiredFields(): void {
  fireEvent.change(screen.getByLabelText(/Título interno/), {
    target: { value: 'Campanha' },
  });
  fireEvent.change(screen.getByLabelText(/Texto da mensagem/), {
    target: { value: 'Olá, {nome}' },
  });
}

function weekdayButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('ScheduledMessageForm recurrence fields', () => {
  it('starts a new daily schedule with every weekday unselected', () => {
    renderForm();
    chooseRecurrence('Diária');

    expect(screen.getByText('Dias da semana')).toBeTruthy();
    for (const day of [
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ]) {
      expect(weekdayButton(day).getAttribute('aria-pressed')).toBe('false');
    }
    expect(screen.getByLabelText(/Horário do envio/)).toBeTruthy();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
  });

  it('shows the weekday selector for weekly schedules without preselection', () => {
    renderForm();
    chooseRecurrence('Semanal');

    expect(screen.getByText('Dias da semana')).toBeTruthy();
    expect(weekdayButton('Segunda-feira').getAttribute('aria-pressed')).toBe('false');
    expect(weekdayButton('Domingo').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows only the monthly day and time for monthly schedules', () => {
    renderForm();
    chooseRecurrence('Mensal');

    expect(screen.getByText('Dia do mês')).toBeTruthy();
    expect(screen.queryByText('Dias da semana')).toBeNull();
    expect(screen.getByLabelText(/Horário do envio/)).toBeTruthy();
    expect(screen.getByLabelText(/Dia do mês/).getAttribute('type')).toBe('number');
  });

  it('keeps the date and time control only for one-time schedules', () => {
    renderForm();

    expect(document.querySelector('input[type="datetime-local"]')).toBeTruthy();
    expect(screen.queryByLabelText('Horário do envio')).toBeNull();
    expect(screen.queryByText('Dias da semana')).toBeNull();
    expect(screen.queryByText('Dia do mês')).toBeNull();
  });

  it('loads saved weekdays and time when editing a daily schedule', () => {
    renderForm(schedule);

    expect(screen.getByText('Dias da semana')).toBeTruthy();
    expect(weekdayButton('Segunda-feira').getAttribute('aria-pressed')).toBe('true');
    expect(weekdayButton('Terça-feira').getAttribute('aria-pressed')).toBe('false');
    expect(weekdayButton('Sexta-feira').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText(/Horário do envio/) as HTMLInputElement).value).toBe('09:00');
  });

  it('loads the monthly day when editing and hides weekdays', () => {
    renderForm({
      ...schedule,
      recurrence: 'MONTHLY',
      weekdays: [],
      dayOfMonth: 31,
      recurringTime: '18:30',
    });

    expect(screen.queryByText('Dias da semana')).toBeNull();
    expect((screen.getByLabelText(/Dia do mês/) as HTMLInputElement).value).toBe('31');
    expect((screen.getByLabelText(/Horário do envio/) as HTMLInputElement).value).toBe('18:30');
  });

  it('loads the day of the first execution for a legacy monthly schedule', () => {
    renderForm({
      ...schedule,
      recurrence: 'MONTHLY',
      weekdays: [],
      dayOfMonth: null,
      recurringTime: null,
      scheduledAt: '2099-01-31T12:00:00.000Z',
      nextRunAt: '2099-02-28T12:00:00.000Z',
    });

    expect((screen.getByLabelText(/Dia do mês/) as HTMLInputElement).value).toBe('31');
    expect((screen.getByLabelText(/Horário do envio/) as HTMLInputElement).value).toBe('09:00');
  });

  it('keeps the saved weekdays when switching between daily and weekly', () => {
    renderForm(schedule);
    chooseRecurrence('Semanal');

    expect(weekdayButton('Segunda-feira').getAttribute('aria-pressed')).toBe('true');
    expect(weekdayButton('Quarta-feira').getAttribute('aria-pressed')).toBe('true');
    expect(weekdayButton('Sexta-feira').getAttribute('aria-pressed')).toBe('true');
  });

  it('loads all weekdays for a legacy daily schedule with an empty selection', () => {
    renderForm({ ...schedule, weekdays: [] });

    for (const day of [
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ]) {
      expect(weekdayButton(day).getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('uses a responsive grid for the weekday selector', () => {
    renderForm(schedule);

    const group = screen.getByRole('group', { name: 'Dias da semana' });
    expect(group.className).toContain('grid-cols-2');
    expect(group.className).toContain('sm:grid-cols-4');
  });
});

describe('ScheduledMessageForm validation and payload', () => {
  it('blocks daily submission without a weekday and shows an inline message', async () => {
    renderForm();
    chooseRecurrence('Diária');
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agendar mensagem' }));
    });

    expect(
      screen.getByText('Selecione pelo menos um dia da semana para continuar.'),
    ).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('blocks weekly submission without a weekday', async () => {
    renderForm();
    chooseRecurrence('Semanal');
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agendar mensagem' }));
    });

    expect(
      screen.getByText('Selecione pelo menos um dia da semana para continuar.'),
    ).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('blocks monthly submission with an invalid day', async () => {
    renderForm();
    chooseRecurrence('Mensal');
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Dia do mês/), { target: { value: '32' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agendar mensagem' }));
    });

    expect(screen.getByText('Informe um dia do mês entre 1 e 31.')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('blocks recurring submission without a valid time', async () => {
    renderForm();
    chooseRecurrence('Diária');
    fireEvent.click(weekdayButton('Segunda-feira'));
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Horário do envio/), {
      target: { value: '' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agendar mensagem' }));
    });

    expect(screen.getByText('Informe um horário válido no formato HH:mm.')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('blocks one-time submission with a past date', async () => {
    renderForm();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Data e hora do envio/), {
      target: { value: '2020-01-01T09:00' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agendar mensagem' }));
    });

    expect(screen.getByText('Informe uma data e hora futura.')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('submits daily schedules with weekdays and time only', async () => {
    renderForm();
    chooseRecurrence('Diária');
    fireEvent.click(weekdayButton('Segunda-feira'));
    fireEvent.change(screen.getByLabelText(/Horário do envio/), {
      target: { value: '10:30' },
    });
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agendar mensagem' }));
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const input = mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      recurrence: 'DAILY',
      weekdays: [1],
      recurringTime: '10:30',
    });
    expect('scheduledAt' in input).toBe(false);
    expect('dayOfMonth' in input).toBe(false);
  });

  it('submits monthly schedules with day and time only', async () => {
    renderForm();
    chooseRecurrence('Mensal');
    fireEvent.change(screen.getByLabelText(/Dia do mês/), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/Horário do envio/), {
      target: { value: '08:15' },
    });
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agendar mensagem' }));
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const input = mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      recurrence: 'MONTHLY',
      dayOfMonth: 15,
      recurringTime: '08:15',
    });
    expect('scheduledAt' in input).toBe(false);
    expect('weekdays' in input).toBe(false);
  });

  it('submits one-time schedules with the full date and time only', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Data e hora do envio/), {
      target: { value: '2099-01-05T09:00' },
    });
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agendar mensagem' }));
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const input = mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      recurrence: 'ONCE',
      scheduledAt: '2099-01-05T09:00',
    });
    expect('weekdays' in input).toBe(false);
    expect('recurringTime' in input).toBe(false);
    expect('dayOfMonth' in input).toBe(false);
  });

  it('submits weekly schedules with every selected weekday', async () => {
    renderForm();
    chooseRecurrence('Semanal');
    fireEvent.click(weekdayButton('Terça-feira'));
    fireEvent.click(weekdayButton('Quinta-feira'));
    fireEvent.change(screen.getByLabelText(/Horário do envio/), {
      target: { value: '14:00' },
    });
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agendar mensagem' }));
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const input = mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      recurrence: 'WEEKLY',
      weekdays: [2, 4],
      recurringTime: '14:00',
    });
  });
});
