// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TenantModuleEntry } from '@/types/modules';

afterEach(cleanup);

const state = vi.hoisted(() => ({
  modules: [] as TenantModuleEntry[],
}));

vi.mock('./queries', () => ({
  useTenantModules: () => ({
    data: state.modules,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateTenantModule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ModulesTab } from './modules-tab';

const base: Omit<TenantModuleEntry, 'id' | 'key' | 'name' | 'enabled'> = {
  description: null,
  category: 'Financeiro',
  icon: null,
  sortOrder: 0,
  controllable: true,
};

describe('ModulesTab', () => {
  it('renders each module with its current state', () => {
    state.modules = [
      { ...base, id: '1', key: 'billing.charges', name: 'Cobranças', enabled: true },
      { ...base, id: '2', key: 'billing.collection', name: 'Régua de Cobrança', enabled: false },
    ];

    render(<ModulesTab tenantId="tenant-1" />);

    expect(screen.getByText('Cobranças')).toBeTruthy();
    expect(screen.getByText('Régua de Cobrança')).toBeTruthy();
    expect(screen.getByText('Ativo')).toBeTruthy();
    expect(screen.getByText('Inativo')).toBeTruthy();
  });

  it('shows an empty state when the catalog is empty', () => {
    state.modules = [];
    render(<ModulesTab tenantId="tenant-1" />);
    expect(screen.getByText('Nenhum módulo cadastrado')).toBeTruthy();
  });
});
