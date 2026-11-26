// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileBottomNavigation } from './mobile-bottom-navigation';

const mocks = vi.hoisted(() => ({
  modules: ['attendance', 'deliveries'],
  unreadCount: 0,
}));

vi.mock('@/features/modules/queries', () => ({
  useEnabledModules: () => ({ data: mocks.modules }),
}));

vi.mock('@/features/attendance/queries', () => ({
  useUnreadCount: () => ({ data: { total: mocks.unreadCount } }),
}));

function renderNavigation(path = '/atendimento/conversas') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileBottomNavigation />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.modules = ['attendance', 'deliveries'];
  mocks.unreadCount = 0;
});

afterEach(cleanup);

describe('MobileBottomNavigation', () => {
  it('navigates between the existing screens and marks the current one', () => {
    renderNavigation();

    const conversations = screen.getByRole('link', { name: 'Conversas' });
    const deliveries = screen.getByRole('link', { name: 'Entregas' });
    expect(conversations.getAttribute('aria-current')).toBe('page');
    expect(deliveries.getAttribute('href')).toBe('/entregas');

    fireEvent.click(deliveries);
    expect(deliveries.getAttribute('aria-current')).toBe('page');
    expect(conversations.hasAttribute('aria-current')).toBe(false);

    fireEvent.click(conversations);
    expect(conversations.getAttribute('aria-current')).toBe('page');
    expect(deliveries.hasAttribute('aria-current')).toBe(false);
  });

  it('leaves updates and calls disabled without changing the current screen', () => {
    renderNavigation();

    for (const name of ['Atualizações', 'Ligações']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }

    expect(screen.getByRole('link', { name: 'Conversas' }).getAttribute('aria-current')).toBe('page');
  });

  it('uses the server unread count and caps the visible badge at 99+', () => {
    mocks.unreadCount = 135;
    renderNavigation();

    expect(screen.getByLabelText('135 mensagens não lidas').textContent).toBe('99+');
  });

  it('does not show an unread badge when there are no unread messages', () => {
    renderNavigation();
    expect(screen.queryByLabelText(/mensagens não lidas/)).toBeNull();
  });

  it('hides deliveries when its module is disabled', () => {
    mocks.modules = ['attendance'];
    renderNavigation();

    expect(screen.queryByRole('link', { name: 'Entregas' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeTruthy();
  });

  it('hides conversations when attendance is disabled', () => {
    mocks.modules = ['deliveries'];
    renderNavigation('/entregas');

    expect(screen.queryByRole('link', { name: 'Conversas' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Entregas' })).toBeTruthy();
  });

  it.each(['/atendimento/conversas?conversation=123', '/contatos', '/configuracoes'])(
    'does not show the bar at %s',
    (path) => {
      renderNavigation(path);
      expect(screen.queryByRole('navigation')).toBeNull();
    },
  );
});
