// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactPicker } from './contact-picker';
import { useContacts } from './queries';

vi.mock('./queries', () => ({ useContacts: vi.fn() }));

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
  if (!window.HTMLElement.prototype.hasPointerCapture) window.HTMLElement.prototype.hasPointerCapture = () => false;
  if (!window.HTMLElement.prototype.setPointerCapture) window.HTMLElement.prototype.setPointerCapture = () => {};
  if (!window.HTMLElement.prototype.releasePointerCapture) window.HTMLElement.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.mocked(useContacts).mockReturnValue({
    data: {
      data: [
        { id: 'contact-1', name: 'Ana Souza', phone: '5511999999999' },
        { id: 'contact-2', name: 'Bruno Lima', phone: '5511888888888' },
      ],
    },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ContactPicker', () => {
  it('filters visible contacts while the user types and selects a result', () => {
    const onValueChange = vi.fn();
    render(<ContactPicker value="" onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.change(screen.getByLabelText('Buscar por nome ou telefone'), { target: { value: 'Ana' } });

    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.queryByText('Bruno Lima')).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Ana Souza/ }));
    expect(onValueChange).toHaveBeenCalledWith('contact-1');
  });

  it('normalizes a formatted phone before querying the API', async () => {
    vi.useFakeTimers();
    render(<ContactPicker value="" onValueChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.change(screen.getByLabelText('Buscar por nome ou telefone'), { target: { value: '(55) 11 99999-9999' } });

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });

    expect(vi.mocked(useContacts)).toHaveBeenLastCalledWith(expect.objectContaining({ search: '5511999999999' }));
  });
});
