// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('./appearance-tab', () => ({ AppearanceTab: () => <div>Aparência</div> }));
vi.mock('./attendance-tab', () => ({ AttendanceTab: () => <div>Atendimento</div> }));
vi.mock('./notifications-tab', () => ({ NotificationsTab: () => <div>Notificações</div> }));
vi.mock('./organization-tab', () => ({ OrganizationTab: () => <div>Organização</div> }));
vi.mock('./team-tab', () => ({ TeamTab: () => <div>Equipe</div> }));
vi.mock('./whatsapp-tab', () => ({ WhatsAppTab: () => <div>WhatsApp</div> }));
vi.mock('@/features/custom-menu/custom-menu-tab', () => ({
  CustomMenuTab: () => <div>Menu Personalizado</div>,
}));

import { SettingsPage } from './settings-page';

afterEach(cleanup);

function renderSettings(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/configuracoes" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsPage', () => {
  it('shows the section selected by the tab query parameter', () => {
    renderSettings('/configuracoes?tab=whatsapp');

    expect(screen.getByRole('tabpanel').textContent).toBe('WhatsApp');
  });

  it('falls back to the organization section without a tab parameter', () => {
    renderSettings('/configuracoes');

    expect(screen.getByRole('tabpanel').textContent).toBe('Organização');
  });

  it('keeps the tabs on desktop and hides them on mobile', () => {
    renderSettings('/configuracoes');

    const tabs = screen.getByRole('tablist');

    expect(tabs.classList.contains('hidden')).toBe(true);
    expect(tabs.classList.contains('lg:inline-flex')).toBe(true);
  });
});
