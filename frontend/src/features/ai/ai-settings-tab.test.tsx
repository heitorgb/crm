// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  AiCatalog,
  AiSettings,
  TranscriptionCatalog,
  TranscriptionSettings,
} from '@/types/ai';

const state = vi.hoisted(() => ({
  save: vi.fn(async (_input: Record<string, unknown>) => undefined),
  test: vi.fn(async () => ({
    ok: true,
    provider: 'OPENAI',
    model: 'gpt-6-luna',
    message: 'Conexão validada com sucesso.',
  })),
  saveTranscription: vi.fn(async (_input: Record<string, unknown>) => undefined),
  testTranscription: vi.fn(async () => ({
    ok: true,
    provider: 'OPENAI',
    model: 'whisper-1',
    message: 'Credencial e modelo de transcrição validados com sucesso.',
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

const transcriptionCatalog: TranscriptionCatalog = {
  providers: [
    {
      id: 'OPENAI',
      label: 'OpenAI',
      description: 'Transcrição oficial.',
      supported: true,
      unsupportedReason: null,
      models: [{ id: 'whisper-1', label: 'Whisper', description: 'Econômico.' }],
    },
    {
      id: 'DEEPSEEK',
      label: 'DeepSeek',
      description: 'Somente texto.',
      supported: false,
      unsupportedReason: 'O DeepSeek não oferece transcrição de áudio.',
      models: [],
    },
    {
      id: 'ANTHROPIC',
      label: 'Anthropic',
      description: 'Somente texto.',
      supported: false,
      unsupportedReason: 'A Anthropic não oferece transcrição de áudio.',
      models: [],
    },
    {
      id: 'OPENROUTER',
      label: 'OpenRouter',
      description: 'Somente texto.',
      supported: false,
      unsupportedReason: 'O OpenRouter não oferece transcrição de áudio.',
      models: [],
    },
  ],
  credentialPolicy: {
    reusedFrom: 'OPENAI',
    description: 'Reutiliza a credencial OpenAI.',
  },
};

const transcriptionSettings: TranscriptionSettings = {
  enabled: false,
  autoEnabled: false,
  provider: 'OPENAI',
  model: 'whisper-1',
  supported: true,
  supportedModels: ['whisper-1'],
  hasCredentials: true,
  credentialProvider: 'OPENAI',
  available: false,
  reason: 'disabled',
  updatedAt: '2026-10-20T12:00:00.000Z',
};

vi.mock('./queries', () => ({
  useAiCatalog: () => ({ data: catalog, isPending: false, isError: false }),
  useAiSettings: () => ({ data: settings, isPending: false, isError: false }),
  useSaveAiSettings: () => ({ mutateAsync: state.save, isPending: false }),
  useTestAiConnection: () => ({ mutateAsync: state.test, isPending: false }),
  useTranscriptionCatalog: () => ({
    data: transcriptionCatalog,
    isPending: false,
    isError: false,
  }),
  useTranscriptionSettings: () => ({
    data: transcriptionSettings,
    isPending: false,
    isError: false,
  }),
  useSaveTranscriptionSettings: () => ({
    mutateAsync: state.saveTranscription,
    isPending: false,
  }),
  useTestTranscription: () => ({
    mutateAsync: state.testTranscription,
    isPending: false,
  }),
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
  state.saveTranscription.mockClear();
  state.testTranscription.mockClear();
});

afterEach(cleanup);

describe('AiSettingsTab', () => {
  it('shows the configured integration and the four providers', () => {
    render(<AiSettingsTab canManage />);

    expect(screen.getByText('Inteligência Artificial')).toBeTruthy();
    expect(screen.getAllByText('Pronta para uso').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Anthropic').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OpenRouter').length).toBeGreaterThan(0);
    expect(screen.getByText('Transcrição de áudio')).toBeTruthy();
    expect(screen.getAllByText('Sem suporte').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'OpenAI' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'DeepSeek' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Anthropic' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'OpenRouter' }).length).toBeGreaterThan(0);
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

  it('saves the independent transcription configuration', async () => {
    render(<AiSettingsTab canManage />);

    fireEvent.click(screen.getByRole('switch', { name: /ativar transcrição de áudio/i }));
    fireEvent.click(screen.getByRole('button', { name: /salvar transcrição/i }));

    expect(state.saveTranscription).toHaveBeenCalledWith({
      enabled: true,
      autoEnabled: false,
      provider: 'OPENAI',
      model: 'whisper-1',
    });
    expect(await screen.findByText('Configuração de transcrição salva.')).toBeTruthy();
  });

  it('shows automatic transcription only after enabling it and saves the preference', async () => {
    render(<AiSettingsTab canManage />);

    expect(
      screen.queryByRole('switch', { name: /transcrever automaticamente/i }),
    ).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: /ativar transcrição de áudio/i }));

    const automatic = screen.getByRole('switch', { name: /transcrever automaticamente/i });
    expect(automatic.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(automatic);
    expect(automatic.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /salvar transcrição/i }));

    expect(state.saveTranscription).toHaveBeenCalledWith({
      enabled: true,
      autoEnabled: true,
      provider: 'OPENAI',
      model: 'whisper-1',
    });
  });

  it('requires an explicit action to remove the stored credential', () => {
    render(<AiSettingsTab canManage />);

    fireEvent.click(screen.getByRole('button', { name: /remover credencial/i }));
    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ clearCredentials: true }));
  });
});
