// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useUiStore } from '@/stores/ui-store';

vi.mock('@/features/auth/queries', () => ({
  useSessionSync: () => undefined,
}));

vi.mock('@/features/notifications/use-message-notifications', () => ({
  useMessageNotifications: () => undefined,
}));

vi.mock('@/features/attendance/attendance-mobile-options', () => ({
  AttendanceMobileOptions: () => null,
}));

vi.mock('@/components/layout/header', () => ({
  Header: () => <header />,
}));

vi.mock('@/components/layout/main-content', () => ({
  MainContent: () => <main />,
}));

vi.mock('@/components/layout/sidebar', () => ({
  Sidebar: () => <div>Menu principal</div>,
}));

import { AppLayout } from './app-layout';

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ mobileSidebarOpen: true, sidebarPosition: 'left' });
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ mobileSidebarOpen: false, sidebarPosition: 'left' });
  localStorage.clear();
});

describe('AppLayout', () => {
  it('opens the mobile menu from the saved side and keeps the close action working', () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );

    const leftDialog = screen.getByRole('dialog');
    expect(leftDialog.className).toContain('left-0');
    expect(leftDialog.className).not.toContain('right-0');

    act(() => {
      useUiStore.setState({ sidebarPosition: 'right' });
    });

    const rightDialog = screen.getByRole('dialog');
    expect(rightDialog.className).toContain('right-0');
    expect(rightDialog.className).not.toContain('left-0');

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(useUiStore.getState().mobileSidebarOpen).toBe(false);
  });
});
