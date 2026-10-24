// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useThemeStore, type Theme } from '@/stores/theme-store';
import { ThemeProvider } from './theme-provider';

type MediaListener = (event: MediaQueryListEvent) => void;

const originalMatchMedia = window.matchMedia;
let prefersDark = false;
let listeners: MediaListener[] = [];

function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        get matches() {
          return query === '(prefers-color-scheme: dark)' ? prefersDark : false;
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: MediaListener) => {
          listeners.push(listener);
        },
        removeEventListener: (_type: string, listener: MediaListener) => {
          listeners = listeners.filter((current) => current !== listener);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

function renderTheme(theme: Theme): void {
  useThemeStore.setState({ theme });
  render(
    <ThemeProvider>
      <div>conteúdo</div>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  prefersDark = false;
  listeners = [];
  installMatchMedia();
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ theme: 'light' });
  localStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.style.colorScheme = '';
});

describe('ThemeProvider', () => {
  it('applies the light theme', () => {
    renderTheme('light');

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('applies the dark theme', () => {
    renderTheme('dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('follows the system preference when the system theme is selected', () => {
    prefersDark = true;
    renderTheme('system');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('reacts to system preference changes while the system theme is selected', () => {
    renderTheme('system');

    expect(document.documentElement.classList.contains('light')).toBe(true);

    act(() => {
      prefersDark = true;
      for (const listener of listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
