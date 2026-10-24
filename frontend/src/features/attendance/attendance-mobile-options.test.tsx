// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAttendanceViewStore } from '@/stores/attendance-view-store';
import { useThemeStore } from '@/stores/theme-store';
import { AttendanceMobileOptions } from './attendance-mobile-options';

vi.mock('@/features/whatsapp/queries', () => ({
  useWhatsAppInstances: () => ({ data: { data: [] } }),
}));

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ theme: 'light' });
  useAttendanceViewStore.setState({
    search: 'cliente',
    status: 'OPEN',
    instanceId: 'instance-1',
    archivedView: false,
  });
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ theme: 'light' });
  localStorage.clear();
  useAttendanceViewStore.setState({
    search: '',
    status: 'ALL',
    instanceId: 'ALL',
    archivedView: false,
  });
});

describe('AttendanceMobileOptions', () => {
  it('does not render the theme configuration inside the mobile menu', () => {
    render(<AttendanceMobileOptions />);

    expect(screen.queryByText('Tema')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Claro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Escuro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sistema' })).toBeNull();
  });

  it('keeps the saved theme preference untouched when the mobile menu is rendered', () => {
    const saved = JSON.stringify({ state: { theme: 'dark' }, version: 0 });
    localStorage.setItem('orderup-theme', saved);
    useThemeStore.setState({ theme: 'dark' });

    render(<AttendanceMobileOptions />);

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(localStorage.getItem('orderup-theme')).toBe(saved);
  });

  it('starts the mobile options with the filters section without a leftover theme block', () => {
    const { container } = render(<AttendanceMobileOptions />);
    const root = container.firstElementChild;

    expect(root?.classList.contains('space-y-2')).toBe(true);
    expect(root?.firstElementChild?.textContent).toBe('Filtros');
  });

  it('does not duplicate the inbox navigation inside the mobile menu', () => {
    render(<AttendanceMobileOptions />);

    expect(screen.queryByRole('group', { name: 'Filtrar por caixa' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Caixa de entrada' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Arquivadas' })).toBeNull();
  });

  it('keeps the remaining filters available and resets them without clearing the search', () => {
    render(<AttendanceMobileOptions />);

    expect(screen.getByRole('combobox', { name: 'Filtrar por WhatsApp' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filtrar por status' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    expect(useAttendanceViewStore.getState()).toMatchObject({
      search: 'cliente',
      status: 'ALL',
      instanceId: 'ALL',
      archivedView: false,
    });
  });
});
