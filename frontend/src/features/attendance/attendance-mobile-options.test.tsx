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

describe('AttendanceMobileOptions inbox navigation', () => {
  it('marks the current box as selected', () => {
    render(<AttendanceMobileOptions />);

    expect(screen.getByRole('button', { name: 'Caixa de entrada' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Arquivadas' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('switches boxes without resetting the other filters', () => {
    render(<AttendanceMobileOptions />);

    fireEvent.click(screen.getByRole('button', { name: 'Arquivadas' }));

    expect(useAttendanceViewStore.getState()).toMatchObject({
      archivedView: true,
      search: 'cliente',
      status: 'OPEN',
      instanceId: 'instance-1',
    });
    expect(screen.getByRole('button', { name: 'Arquivadas' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Caixa de entrada' }));

    expect(useAttendanceViewStore.getState().archivedView).toBe(false);
  });
});
