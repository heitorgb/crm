// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/features/modules/queries', () => ({
  useEnabledModules: () => ({ data: undefined }),
}));

import { Sidebar } from './sidebar';

afterEach(cleanup);

function renderSidebar(props: { collapsed: boolean; showCollapseToggle?: boolean }) {
  return render(
    <MemoryRouter initialEntries={['/leads']}>
      <TooltipProvider>
        <Sidebar {...props} />
      </TooltipProvider>
    </MemoryRouter>,
  );
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

  it('renders the collapse toggle on the desktop sidebar', () => {
    renderSidebar({ collapsed: false, showCollapseToggle: true });
    expect(screen.getByRole('button', { name: 'Recolher menu' })).toBeTruthy();
  });

  it('hides the collapse toggle on the mobile sidebar', () => {
    renderSidebar({ collapsed: false, showCollapseToggle: false });
    expect(screen.queryByRole('button', { name: 'Recolher menu' })).toBeNull();
  });
});
