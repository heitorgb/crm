// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/features/modules/queries', () => ({
  useEnabledModules: () => ({ data: undefined }),
}));

import { useUiStore } from '@/stores/ui-store';
import type { CustomMenuGroup } from '@/types/custom-menu';
import { Sidebar } from './sidebar';

const customMenuState = vi.hoisted(() => ({
  data: undefined as CustomMenuGroup[] | undefined,
}));

vi.mock('@/features/custom-menu/queries', () => ({
  useCustomMenuNavigation: () => ({ data: customMenuState.data }),
}));

function resetUiState() {
  localStorage.clear();
  useUiStore.setState({ expandedNavGroups: {} });
}

beforeEach(resetUiState);

afterEach(() => {
  cleanup();
  customMenuState.data = undefined;
  resetUiState();
});

function renderSidebar(props: {
  collapsed: boolean;
  showCollapseToggle?: boolean;
  settingsAsGroup?: boolean;
  onNavigate?: () => void;
  initialEntries?: string[];
}) {
  const { initialEntries = ['/leads'], ...sidebarProps } = props;
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <TooltipProvider>
        <Sidebar {...sidebarProps} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function customGroup(overrides: Partial<CustomMenuGroup> = {}): CustomMenuGroup {
  return {
    id: 'group-1',
    name: 'Lojas',
    icon: 'store',
    active: true,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    buttons: [
      {
        id: 'button-1',
        name: 'JP Peças',
        url: 'https://pecas.example.com',
        icon: 'external-link',
        active: true,
        position: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('Sidebar', () => {
  it('keeps the tooltip-wrapped links full width and centered when collapsed', () => {
    const { container } = renderSidebar({ collapsed: true });
    const link = container.querySelector('a[href="/leads"]');

    expect(link?.textContent).toBe('');
    expect(link?.classList.contains('w-full')).toBe(true);
    expect(link?.classList.contains('justify-center')).toBe(true);
    expect(link?.classList.contains('bg-sidebar-accent')).toBe(true);
  });

  it('keeps the collapsed item icon at the expanded size without shrinking', () => {
    const { container } = renderSidebar({ collapsed: true });
    const icon = container.querySelector('a[href="/leads"] svg');

    expect(icon?.classList.contains('size-4')).toBe(true);
    expect(icon?.classList.contains('size-5')).toBe(false);
    expect(icon?.classList.contains('shrink-0')).toBe(true);
  });

  it('exposes the item title as the accessible name when collapsed', () => {
    const { container } = renderSidebar({ collapsed: true });
    const link = container.querySelector('a[href="/leads"]');

    expect(link?.getAttribute('aria-label')).toBe('Oportunidades');
  });

  it('keeps the expanded item icon at the same size as the collapsed one', () => {
    useUiStore.setState({ expandedNavGroups: { crm: true } });
    const { container } = renderSidebar({ collapsed: false });
    const icon = container.querySelector('a[href="/leads"] svg');

    expect(icon?.classList.contains('size-4')).toBe(true);
    expect(icon?.classList.contains('shrink-0')).toBe(true);
  });


  it('keeps settings as a direct link on the desktop sidebar', () => {
    const { container } = renderSidebar({ collapsed: false });
    const link = container.querySelector('a[href="/configuracoes"]');

    expect(link?.textContent).toBe('Configurações');
    expect(screen.queryByRole('button', { name: 'Configurações' })).toBeNull();
  });

  it('starts the mobile settings group minimized and expands all its sections', () => {
    const { container } = renderSidebar({
      collapsed: false,
      settingsAsGroup: true,
      initialEntries: ['/configuracoes'],
    });

    const toggle = screen.getByRole('button', { name: 'Configurações' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Equipe' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    expect(container.querySelector('a[href="/configuracoes"]')?.textContent).toBe('Organização');
    expect(
      container.querySelector('a[href="/configuracoes?tab=team"]')?.textContent,
    ).toBe('Equipe');
    expect(
      container.querySelector('a[href="/configuracoes?tab=appearance"]')?.textContent,
    ).toBe('Aparência');
    expect(
      container.querySelector('a[href="/configuracoes?tab=attendance"]')?.textContent,
    ).toBe('Atendimento');
    expect(
      container.querySelector('a[href="/configuracoes?tab=notifications"]')?.textContent,
    ).toBe('Notificações');
    expect(
      container.querySelector('a[href="/configuracoes?tab=whatsapp"]')?.textContent,
    ).toBe('WhatsApp');
    expect(
      container.querySelector('a[href="/configuracoes?tab=menu"]')?.textContent,
    ).toBe('Menu Personalizado');
    expect(container.querySelector('a[href="/configuracoes?tab=ai"]')?.textContent).toBe('IA');
  });

  it('collapses and expands the settings group independently', () => {
    renderSidebar({
      collapsed: false,
      settingsAsGroup: true,
      initialEntries: ['/configuracoes'],
    });

    const toggle = screen.getByRole('button', { name: 'Configurações' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Equipe' })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Equipe' })).toBeNull();
  });

  it('highlights only the settings option matching the active tab', () => {
    const { container } = renderSidebar({
      collapsed: false,
      settingsAsGroup: true,
      initialEntries: ['/configuracoes?tab=whatsapp'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Configurações' }));

    const whatsapp = container.querySelector('a[href="/configuracoes?tab=whatsapp"]');
    const team = container.querySelector('a[href="/configuracoes?tab=team"]');
    const organization = container.querySelector('a[href="/configuracoes"]');

    expect(whatsapp?.classList.contains('bg-sidebar-accent')).toBe(true);
    expect(team?.classList.contains('bg-sidebar-accent')).toBe(false);
    expect(organization?.classList.contains('bg-sidebar-accent')).toBe(false);
  });

  it('closes the mobile menu after selecting a settings option', () => {
    const onNavigate = vi.fn();
    renderSidebar({
      collapsed: false,
      settingsAsGroup: true,
      onNavigate,
      initialEntries: ['/configuracoes'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Configurações' }));
    fireEvent.click(screen.getByRole('link', { name: 'Equipe' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().expandedNavGroups.configuracoes).toBe(true);
  });


  it('starts every navigation group minimized without saved preferences', () => {
    renderSidebar({ collapsed: false });

    for (const name of [
      'CRM',
      'Atendimento',
      'Ferramentas',
      'Contatos',
      'Financeiro',
      'Integrações',
    ]) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-expanded')).toBe('false');
    }

    expect(screen.queryByRole('link', { name: 'Oportunidades' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Conversas' })).toBeNull();
  });

  it('expands each navigation group independently and persists its state', () => {
    renderSidebar({ collapsed: false });

    const crm = screen.getByRole('button', { name: 'CRM' });
    const attendance = screen.getByRole('button', { name: 'Atendimento' });

    fireEvent.click(crm);
    expect(crm.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Oportunidades' })).toBeTruthy();

    fireEvent.click(attendance);
    expect(attendance.getAttribute('aria-expanded')).toBe('true');
    expect(crm.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(crm);
    expect(crm.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Oportunidades' })).toBeNull();
    expect(attendance.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeTruthy();

    const stored = JSON.parse(localStorage.getItem('orderup-ui') ?? '{}').state;
    expect(stored.expandedNavGroups).toMatchObject({ crm: false, atendimento: true });
  });

  it('restores saved open, closed and mixed group preferences after hydration', async () => {
    localStorage.setItem(
      'orderup-ui',
      JSON.stringify({
        state: {
          expandedNavGroups: {
            crm: true,
            atendimento: false,
            financeiro: false,
            configuracoes: true,
          },
        },
        version: 0,
      }),
    );

    await useUiStore.persist.rehydrate();

    renderSidebar({
      collapsed: false,
      settingsAsGroup: true,
    });

    expect(screen.getByRole('button', { name: 'CRM' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Oportunidades' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Atendimento' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByRole('link', { name: 'Conversas' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Financeiro' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByRole('link', { name: 'Cobranças' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByRole('link', { name: 'Equipe' })).toBeTruthy();
  });

  it('keeps all groups minimized after restoring saved preferences', async () => {
    localStorage.setItem(
      'orderup-ui',
      JSON.stringify({
        state: {
          expandedNavGroups: {
            crm: false,
            atendimento: false,
            ferramentas: false,
            contatos: false,
            financeiro: false,
            integracoes: false,
            configuracoes: false,
          },
        },
        version: 0,
      }),
    );

    await useUiStore.persist.rehydrate();

    renderSidebar({ collapsed: false, settingsAsGroup: true });

    for (const name of [
      'CRM',
      'Atendimento',
      'Ferramentas',
      'Contatos',
      'Financeiro',
      'Integrações',
      'Configurações',
    ]) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-expanded')).toBe('false');
    }
  });


  it('keeps all groups expanded after restoring saved preferences', async () => {
    localStorage.setItem(
      'orderup-ui',
      JSON.stringify({
        state: {
          expandedNavGroups: {
            crm: true,
            atendimento: true,
            ferramentas: true,
            contatos: true,
            financeiro: true,
            integracoes: true,
            configuracoes: true,
          },
        },
        version: 0,
      }),
    );

    await useUiStore.persist.rehydrate();

    renderSidebar({ collapsed: false, settingsAsGroup: true });

    for (const name of [
      'CRM',
      'Atendimento',
      'Ferramentas',
      'Contatos',
      'Financeiro',
      'Integrações',
      'Configurações',
    ]) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('renders the collapse toggle on the desktop sidebar', () => {
    renderSidebar({ collapsed: false, showCollapseToggle: true });
    expect(screen.getByRole('button', { name: 'Recolher menu' })).toBeTruthy();
  });

  it('hides the collapse toggle on the mobile sidebar', () => {
    renderSidebar({ collapsed: false, showCollapseToggle: false });
    expect(screen.queryByRole('button', { name: 'Recolher menu' })).toBeNull();
  });

  it('renders active custom menu groups with safe external links in a new tab', () => {
    customMenuState.data = [customGroup()];
    const { container } = renderSidebar({ collapsed: false });

    const toggle = screen.getByRole('button', { name: 'Lojas' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);

    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="https://pecas.example.com"]',
    );

    expect(link?.textContent).toBe('JP Peças');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('filters custom groups without safe URLs and keeps working when loading fails', () => {
    customMenuState.data = [
      customGroup({ id: 'group-2', name: 'Inválido' }),
    ];
    customMenuState.data[0].buttons[0].url = 'javascript:alert(1)';

    const { container } = renderSidebar({ collapsed: false });

    expect(screen.queryByRole('button', { name: 'Inválido' })).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
