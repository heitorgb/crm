// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AiCatalog, AiSettings } from '@/types/ai';

const state = vi.hoisted(() => ({
  save: vi.fn(async (_input: Record<string, unknown>) => undefined),
  test: vi.fn(async () => ({
    ok: true,
    provider: 'OPENAI',
    model: 'gpt-6-luna',
    message: 'Conexão validada com sucesso.',
  })),
}));

const catalog: AiCatalog = {
  providers: [
    {
      id: 'OPENAI',
      label: 'OpenAI',
      description: 'Modelos GPT.',
      credentialLabel: 'Chave da API',
      models: [
        { id: 'gpt-6-luna', label: 'GPT-6 Luna', description: 'Rápido.' },
        { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', description: 'Equilibrado.' },
        { id: 'gpt-6-astra', label: 'GPT-6 Astra', description: 'Avançado.' },
      ],
    },
    {
      id: 'DEEPSEEK',
      label: 'DeepSeek',
      description: 'Modelos DeepSeek.',
      credentialLabel: 'Chave da API',
      models: [
        { id: 'deepseek-flash', label: 'DeepSeek Flash', description: 'Rápido.' },
        { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'Avançado.' },
        { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'Legado.' },
      ],
    },
    {
      id: 'ANTHROPIC',
      label: 'Anthropic',
      description: 'Modelos Claude.',
      credentialLabel: 'Chave da API',
      models: [
        { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', description: 'Rápido.' },
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', description: 'Equilibrado.' },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'Avançado.' },
      ],
    },
    {
      id: 'OPENROUTER',
      label: 'OpenRouter',
      description: 'Modelos de vários desenvolvedores.',
      credentialLabel: 'Chave da API',
      models: [
        {
          id: 'anthropic/claude-haiku-5-5',
          label: 'Claude Haiku 5.5 (Anthropic)',
          description: 'Rápido.',
        },
        {
          id: 'openai/gpt-5.4-mini',
          label: 'GPT-5.4 Mini (OpenAI)',
          description: 'Equilibrado.',
        },
        {
          id: 'google/gemini-3.1-flash-lite',
          label: 'Gemini 3.1 Flash Lite (Google)',
          description: 'Econômico.',
        },
      ],
    },
  ],
  formalities: [
    { id: 'PROFESSIONAL', label: 'Profissional', description: 'Cotidiano.' },
    { id: 'FORMAL', label: 'Formal', description: 'Organizado.' },
    { id: 'VERY_FORMAL', label: 'Muito formal', description: 'Institucional.' },
  ],
};

const settings: AiSettings = {
  provider: 'OPENAI',
  model: 'gpt-6-luna',
  formality: 'PROFESSIONAL',
  enabled: true,
  hasCredentials: true,
  configuredProviders: ['OPENAI'],
  available: true,
  updatedAt: '2026-10-20T12:00:00.000Z',
};

vi.mock('./queries', () => ({
  useAiCatalog: () => ({ data: catalog, isPending: false, isError: false }),
  useAiSettings: () => ({ data: settings, isPending: false, isError: false }),
  useSaveAiSettings: () => ({ mutateAsync: state.save, isPending: false }),
  useTestAiConnection: () => ({ mutateAsync: state.test, isPending: false }),
}));

import { AiSettingsTab } from './ai-settings-tab';

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

beforeEach(() => {
  state.save.mockClear();
  state.test.mockClear();
});

afterEach(cleanup);

describe('AiSettingsTab', () => {
  it('shows the configured integration and the four providers', () => {
    render(<AiSettingsTab canManage />);

    expect(screen.getByText('Inteligência Artificial')).toBeTruthy();
    expect(screen.getByText('Pronta para uso')).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('DeepSeek')).toBeTruthy();
    expect(screen.getByText('Anthropic')).toBeTruthy();
    expect(screen.getByText('OpenRouter')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'OpenAI' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'DeepSeek' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Anthropic' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'OpenRouter' })).toBeTruthy();
    expect(screen.getByText('Credencial configurada')).toBeTruthy();
  });

  it('saves without overwriting the stored credential when the field is empty', async () => {
    render(<AiSettingsTab canManage />);

    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    expect(state.save).toHaveBeenCalledTimes(1);
    const input = state.save.mock.calls[0][0];
    expect(input).toMatchObject({
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'PROFESSIONAL',
      enabled: true,
    });
    expect(input).not.toHaveProperty('apiKey');
    expect(input).not.toHaveProperty('clearCredentials');
    expect((await screen.findByRole('status')).textContent).toBe('Configurações de IA salvas.');
  });

  it('sends a typed credential when replacing the stored one', () => {
    render(<AiSettingsTab canManage />);

    fireEvent.change(screen.getByLabelText('Chave da API'), {
      target: { value: 'sk-new-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-new-key' }));
  });

  it('tests the connection with the current form values', async () => {
    render(<AiSettingsTab canManage />);

    fireEvent.click(screen.getByRole('button', { name: /testar conexão/i }));

    expect(state.test).toHaveBeenCalledWith({
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      apiKey: undefined,
    });
    expect(await screen.findByText('Conexão validada com sucesso.')).toBeTruthy();
  });

  it('requires an explicit action to remove the stored credential', () => {
    render(<AiSettingsTab canManage />);

    fireEvent.click(screen.getByRole('button', { name: /remover credencial/i }));
    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ clearCredentials: true }));
  });
});
