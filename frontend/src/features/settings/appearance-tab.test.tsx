// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useThemeStore } from '@/stores/theme-store';
import { useUiStore } from '@/stores/ui-store';
import { AppearanceTab } from './appearance-tab';

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ sidebarPosition: 'left' });
  useThemeStore.setState({ theme: 'light' });
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ sidebarPosition: 'left' });
  localStorage.clear();
});

describe('AppearanceTab', () => {
  it('falls back to the left side when there is no saved preference', async () => {
    useUiStore.setState(useUiStore.getInitialState(), true);
    localStorage.clear();

    await useUiStore.persist.rehydrate();

    expect(useUiStore.getState().sidebarPosition).toBe('left');
  });

  it('uses the left side as the default and persists the right side selection', () => {
    render(<AppearanceTab />);

    const left = screen.getByRole('button', { name: 'Esquerda' });
    const right = screen.getByRole('button', { name: 'Direita' });

    expect(left.getAttribute('aria-pressed')).toBe('true');
    expect(right.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(right);

    expect(useUiStore.getState().sidebarPosition).toBe('right');
    expect(left.getAttribute('aria-pressed')).toBe('false');
    expect(right.getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('orderup-ui') ?? '{}').state.sidebarPosition).toBe(
      'right',
    );
  });

  it('restores the saved position when the store rehydrates', async () => {
    localStorage.setItem(
      'orderup-ui',
      JSON.stringify({
        state: { sidebarCollapsed: false, sidebarPosition: 'right' },
        version: 0,
      }),
    );

    await useUiStore.persist.rehydrate();

    expect(useUiStore.getState().sidebarPosition).toBe('right');
  });
});
