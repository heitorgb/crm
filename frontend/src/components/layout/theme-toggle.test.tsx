// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useThemeStore, type Theme } from '@/stores/theme-store';
import { ThemeToggle } from './theme-toggle';

beforeAll(() => {
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {};
  }
});

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ theme: 'light' });
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ theme: 'light' });
  localStorage.clear();
});

function openThemeMenu(): void {
  const trigger = screen.getByRole('button', { name: 'Alterar tema' });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

function selectTheme(label: string): void {
  openThemeMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

describe('ThemeToggle', () => {
  it('keeps the theme section available with all desktop options', () => {
    render(<ThemeToggle />);

    openThemeMenu();

    expect(screen.getByText('Tema')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Claro' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Escuro' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Sistema' })).toBeTruthy();
  });

  it.each<{ label: string; theme: Theme }>([
    { label: 'Claro', theme: 'light' },
    { label: 'Escuro', theme: 'dark' },
    { label: 'Sistema', theme: 'system' },
  ])('applies and persists the $label option', ({ label, theme }) => {
    render(<ThemeToggle />);

    selectTheme(label);

    expect(useThemeStore.getState().theme).toBe(theme);
    expect(JSON.parse(localStorage.getItem('orderup-theme') ?? '{}').state.theme).toBe(theme);
  });
});
