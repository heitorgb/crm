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
  MODULE_KEYS.CRM,
  MODULE_KEYS.BILLING_CHARGES,
  MODULE_KEYS.BILLING_COLLECTION,
  MODULE_KEYS.WEBHOOKS,
];

describe('visibleNavigation', () => {
  it('shows the business entries when their modules are enabled', () => {
    const entries = visibleNavigation({ platformAdmin: false, enabledModules: allModules });
    expect(titles(entries)).toEqual(
      expect.arrayContaining([
        'CRM',
        'Oportunidades',
        'Etiquetas',
        'Conversas',
        'Ferramentas',
        'Respostas rápidas',
        'Mensagens agendadas',
        'Contatos',
        'Cobranças',
        'Webhooks',
      ]),
    );
  });

  it('groups tools under Ferramentas instead of the attendance group', () => {
    const entries = visibleNavigation({ platformAdmin: false, enabledModules: allModules });
    const attendance = entries.find(
      (entry): entry is Extract<NavEntry, { items: unknown[] }> =>
        isNavGroup(entry) && entry.title === 'Atendimento',
    );
    const tools = entries.find(
      (entry): entry is Extract<NavEntry, { items: unknown[] }> =>
        isNavGroup(entry) && entry.title === 'Ferramentas',
    );

    expect(attendance?.items.map((item) => item.title)).toEqual(['Conversas']);
    expect(tools?.items.map((item) => item.title)).toEqual([
      'Respostas rápidas',
      'Mensagens agendadas',
    ]);
  });

  it('hides the entry and its group when the module is disabled', () => {
    const entries = visibleNavigation({
      platformAdmin: false,
      enabledModules: [MODULE_KEYS.ATTENDANCE, MODULE_KEYS.CONTACTS],
    });

    expect(titles(entries)).not.toContain('Cobranças');
    expect(titles(entries)).not.toContain('Financeiro');
    expect(titles(entries)).not.toContain('CRM');
    expect(titles(entries)).not.toContain('Oportunidades');
    expect(titles(entries)).not.toContain('Etiquetas');
    expect(titles(entries)).toContain('Ferramentas');
    expect(titles(entries)).toContain('Respostas rápidas');
    expect(titles(entries)).toContain('Mensagens agendadas');
  });

  it('hides the tools group when the attendance module is disabled', () => {
    const entries = visibleNavigation({
      platformAdmin: false,
      enabledModules: [MODULE_KEYS.CRM, MODULE_KEYS.CONTACTS],
    });

    expect(titles(entries)).not.toContain('Ferramentas');
    expect(titles(entries)).not.toContain('Respostas rápidas');
    expect(titles(entries)).not.toContain('Mensagens agendadas');
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
      expect.arrayContaining(['CRM', 'Oportunidades', 'Etiquetas', 'Conversas', 'Contatos', 'Cobranças', 'Webhooks']),
    );
  });
});
