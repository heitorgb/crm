// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAttendanceViewStore } from '@/stores/attendance-view-store';
import { AttendanceMobileOptions } from './attendance-mobile-options';

vi.mock('@/features/whatsapp/queries', () => ({
  useWhatsAppInstances: () => ({ data: { data: [] } }),
}));

beforeEach(() => {
  useAttendanceViewStore.setState({
    search: 'cliente',
    status: 'OPEN',
    instanceId: 'instance-1',
    archivedView: false,
  });
});

afterEach(() => {
  cleanup();
  useAttendanceViewStore.setState({
    search: '',
    status: 'ALL',
    instanceId: 'ALL',
    archivedView: false,
  });
});

describe('AttendanceMobileOptions', () => {
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
