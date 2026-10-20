import { describe, expect, it } from 'vitest';
import { isNavGroup, visibleNavigation, type NavEntry } from './navigation';
import { MODULE_KEYS } from '@/types/modules';

function titles(entries: NavEntry[]): string[] {
  return entries.flatMap((entry) =>
    isNavGroup(entry) ? [entry.title, ...entry.items.map((item) => item.title)] : [entry.title],
  );
}

const allModules = [
  MODULE_KEYS.ATTENDANCE,
  MODULE_KEYS.CONTACTS,
  MODULE_KEYS.BILLING_CHARGES,
  MODULE_KEYS.BILLING_COLLECTION,
  MODULE_KEYS.WEBHOOKS,
];

describe('visibleNavigation', () => {
  it('shows the business entries when their modules are enabled', () => {
    const entries = visibleNavigation({ platformAdmin: false, enabledModules: allModules });
    expect(titles(entries)).toEqual(
      expect.arrayContaining(['Conversas', 'Contatos', 'Cobranças', 'Webhooks']),
    );
  });

  it('hides the entry and its group when the module is disabled', () => {
    const entries = visibleNavigation({
      platformAdmin: false,
      enabledModules: [MODULE_KEYS.ATTENDANCE, MODULE_KEYS.CONTACTS],
    });

    expect(titles(entries)).not.toContain('Cobranças');
    expect(titles(entries)).not.toContain('Financeiro');
  });

  it('keeps administrative navigation for platform admins regardless of modules', () => {
    const asAdmin = visibleNavigation({ platformAdmin: true, enabledModules: [] });
    expect(titles(asAdmin)).toContain('Organizações');
    expect(titles(asAdmin)).toContain('Configurações da plataforma');

    const asUser = visibleNavigation({ platformAdmin: false, enabledModules: allModules });
    expect(titles(asUser)).not.toContain('Organizações');
    expect(titles(asUser)).not.toContain('Configurações da plataforma');
  });

  it('keeps entries visible while the module list is still loading', () => {
    const entries = visibleNavigation({ platformAdmin: false, enabledModules: undefined });
    expect(titles(entries)).toEqual(
      expect.arrayContaining(['Conversas', 'Contatos', 'Cobranças', 'Webhooks']),
    );
  });
});
