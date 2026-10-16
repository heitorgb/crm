// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

afterEach(cleanup);

const state = vi.hoisted(() => ({
  enabled: undefined as string[] | undefined,
  pending: false,
}));

vi.mock('./queries', () => ({
  useEnabledModules: () => ({ data: state.enabled, isPending: state.pending }),
}));

import { ModuleRoute } from './module-route';

function renderRoute(enabled: string[] | undefined) {
  state.enabled = enabled;
  state.pending = false;

  render(
    <MemoryRouter initialEntries={['/cobrancas']}>
      <Routes>
        <Route
          path="/cobrancas"
          element={
            <ModuleRoute moduleKey="billing.charges">
              <div>Conteúdo de cobranças</div>
            </ModuleRoute>
          }
        />
        <Route path="/indisponivel" element={<div>Funcionalidade indisponível</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ModuleRoute', () => {
  it('renders the route when the module is enabled', () => {
    renderRoute(['billing.charges']);
    expect(screen.getByText('Conteúdo de cobranças')).toBeTruthy();
  });

  it('redirects to the unavailable page when the module is disabled', () => {
    renderRoute(['attendance']);
    expect(screen.getByText('Funcionalidade indisponível')).toBeTruthy();
    expect(screen.queryByText('Conteúdo de cobranças')).toBeNull();
  });
});
