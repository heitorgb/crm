// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/features/modules/queries', () => ({
  useEnabledModules: () => ({ data: undefined }),
}));

import type { CustomMenuGroup } from '@/types/custom-menu';
import { Sidebar } from './sidebar';

const customMenuState = vi.hoisted(() => ({
  data: undefined as CustomMenuGroup[] | undefined,
}));

vi.mock('@/features/custom-menu/queries', () => ({
  useCustomMenuNavigation: () => ({ data: customMenuState.data }),
}));

afterEach(() => {
  cleanup();
  customMenuState.data = undefined;
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

  it('renders settings as an expandable group on the mobile sidebar', () => {
    const { container } = renderSidebar({
      collapsed: false,
      settingsAsGroup: true,
      initialEntries: ['/configuracoes'],
    });

    const toggle = screen.getByRole('button', { name: 'Configurações' });
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
  });

  it('collapses and expands the settings group', () => {
    renderSidebar({
      collapsed: false,
      settingsAsGroup: true,
      initialEntries: ['/configuracoes'],
    });

    const toggle = screen.getByRole('button', { name: 'Configurações' });
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Equipe' })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Equipe' })).toBeTruthy();
  });

  it('highlights only the settings option matching the active tab', () => {
    const { container } = renderSidebar({
      collapsed: false,
      settingsAsGroup: true,
      initialEntries: ['/configuracoes?tab=whatsapp'],
    });

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

    fireEvent.click(screen.getByRole('link', { name: 'Equipe' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
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

    expect(screen.getByRole('button', { name: 'Lojas' })).toBeTruthy();
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
