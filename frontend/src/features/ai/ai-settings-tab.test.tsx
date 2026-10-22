// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  saveCredential: vi.fn(
    async (_args: { provider: string; input: Record<string, unknown> }) => undefined,
  ),
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
  useSaveAiCredential: () => ({ mutateAsync: state.saveCredential, isPending: false }),
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
  state.saveCredential.mockClear();
  state.saveTranscription.mockClear();
  state.testTranscription.mockClear();
});

afterEach(cleanup);

function openSection(name: RegExp): void {
  fireEvent.mouseDown(screen.getByRole('tab', { name }));
}

describe('AiSettingsTab', () => {
  it('organizes the settings into sub-tabs and places activation before the provider', () => {
    render(<AiSettingsTab canManage />);

    expect(screen.getByRole('tab', { name: /copiloto ia/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /transcrição/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /credenciais/i })).toBeTruthy();

    const copilotPanel = screen.getByRole('tabpanel');
    expect(within(copilotPanel).getByText('Copiloto IA')).toBeTruthy();
    expect(within(copilotPanel).getByText('Ativar IA no atendimento')).toBeTruthy();
    expect(within(copilotPanel).getByText('Provedor')).toBeTruthy();
    expect(within(copilotPanel).getByText('Modelo do Copiloto')).toBeTruthy();
    expect(within(copilotPanel).getByText('Nível de formalidade')).toBeTruthy();
    expect(within(copilotPanel).queryByText('Credenciais')).toBeNull();
    expect(within(copilotPanel).queryByLabelText('Chave da API')).toBeNull();
    expect(within(copilotPanel).queryByText('Modelos GPT.')).toBeNull();
    expect(within(copilotPanel).getByText('Rápido.')).toBeTruthy();

    const activation = within(copilotPanel).getByText('Ativar IA no atendimento');
    const provider = within(copilotPanel).getByText('Provedor');
    expect(
      activation.compareDocumentPosition(provider) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows transcription settings only in the transcription sub-tab', () => {
    render(<AiSettingsTab canManage />);

    const copilotPanel = screen.getByRole('tabpanel');
    expect(within(copilotPanel).queryByText('Transcrição de áudio')).toBeNull();

    openSection(/transcrição/i);

    const transcriptionPanel = screen.getByRole('tabpanel');
    expect(within(transcriptionPanel).getByText('Transcrição de áudio')).toBeTruthy();
    expect(within(transcriptionPanel).getAllByText('Sem suporte').length).toBeGreaterThan(0);
    expect(within(transcriptionPanel).queryByText('Inteligência Artificial')).toBeNull();
    expect(within(transcriptionPanel).queryByText('Copiloto IA')).toBeNull();
  });

  it('disables copilot fields while the activation is off and restores them', () => {
    render(<AiSettingsTab canManage />);

    const activation = screen.getByRole('switch', { name: /ativar ia no atendimento/i });
    fireEvent.click(activation);

    expect(activation.getAttribute('aria-checked')).toBe('false');
    expect(activation.hasAttribute('disabled')).toBe(false);

    const provider = screen.getByRole('button', { name: /provedor openai/i });
    const model = screen.getByRole('combobox', { name: /modelo de ia/i });
    const formality = screen.getByRole('button', { name: /^formal/i });

    expect((provider as HTMLButtonElement).disabled).toBe(true);
    expect((model as HTMLButtonElement).disabled).toBe(true);
    expect((formality as HTMLButtonElement).disabled).toBe(true);
    expect(provider.getAttribute('aria-pressed')).toBe('true');
    expect(model.textContent).toContain('GPT-6 Luna');

    fireEvent.click(activation);

    expect((screen.getByRole('button', { name: /provedor openai/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      (screen.getByRole('combobox', { name: /modelo de ia/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole('button', { name: /^formal/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('saves the disabled state without clearing the stored configuration', () => {
    render(<AiSettingsTab canManage />);

    fireEvent.click(screen.getByRole('switch', { name: /ativar ia no atendimento/i }));
    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    expect(state.save).toHaveBeenCalledWith({
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      formality: 'PROFESSIONAL',
      enabled: false,
    });
    const input = state.save.mock.calls[0][0];
    expect(input).not.toHaveProperty('apiKey');
    expect(input).not.toHaveProperty('clearCredentials');
  });

  it('updates the model options when the provider changes', () => {
    render(<AiSettingsTab canManage />);

    fireEvent.click(screen.getByRole('button', { name: /provedor deepseek/i }));

    expect(screen.getByRole('button', { name: /provedor deepseek/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    const saveButton = screen.getByRole('button', { name: /salvar configurações/i });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);

    expect(state.save).toHaveBeenCalledWith({
      provider: 'DEEPSEEK',
      model: 'deepseek-flash',
      formality: 'PROFESSIONAL',
      enabled: true,
    });
  });

  it('tests the connection with the stored credential', async () => {
    render(<AiSettingsTab canManage />);

    fireEvent.click(screen.getByRole('button', { name: /testar conexão/i }));

    expect(state.test).toHaveBeenCalledWith({
      provider: 'OPENAI',
      model: 'gpt-6-luna',
    });
    expect(await screen.findByText('Conexão validada com sucesso.')).toBeTruthy();
  });

  it('shows the credential status and opens the dialog for the selected provider', () => {
    render(<AiSettingsTab canManage />);

    openSection(/credenciais/i);

    const credentialsPanel = screen.getByRole('tabpanel');
    expect(within(credentialsPanel).getByText('Credenciais de IA')).toBeTruthy();
    expect(within(credentialsPanel).getAllByText('Configurada').length).toBeGreaterThan(0);
    expect(within(credentialsPanel).getAllByText('Copiloto').length).toBeGreaterThan(0);
    expect(within(credentialsPanel).getAllByText('Transcrição').length).toBeGreaterThan(0);
    expect(
      within(credentialsPanel).getByText(/transcrição reutiliza a credencial OpenAI/i),
    ).toBeTruthy();
    expect(
      within(credentialsPanel).getByRole('button', { name: /gerenciar credencial openai/i }),
    ).toBeTruthy();

    fireEvent.click(
      within(credentialsPanel).getByRole('button', { name: /gerenciar credencial openai/i }),
    );

    const dialog = screen.getByRole('dialog', { name: /gerenciar credencial · openai/i });
    expect(within(dialog).getByText('Credencial configurada')).toBeTruthy();
    expect(within(dialog).getByText('Compartilhada')).toBeTruthy();
    expect(within(dialog).getByText(/afeta os recursos: Copiloto e Transcrição/i)).toBeTruthy();
    expect(within(dialog).getByLabelText('Chave da API').getAttribute('type')).toBe('password');
    expect((within(dialog).getByLabelText('Chave da API') as HTMLInputElement).value).toBe('');

    fireEvent.click(within(dialog).getByRole('button', { name: /cancelar/i }));

    expect(screen.getByRole('tab', { name: /copiloto ia/i }).getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(screen.getByRole('tab', { name: /credenciais/i }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('saves a new credential from the dialog', async () => {
    render(<AiSettingsTab canManage />);

    openSection(/credenciais/i);
    fireEvent.click(screen.getByRole('button', { name: /gerenciar credencial openai/i }));

    const dialog = screen.getByRole('dialog', { name: /gerenciar credencial · openai/i });
    const save = within(dialog).getByRole('button', { name: /salvar credencial/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Chave da API'), {
      target: { value: 'sk-new-key' },
    });
    fireEvent.click(save);

    expect(state.saveCredential).toHaveBeenCalledWith({
      provider: 'OPENAI',
      input: { apiKey: 'sk-new-key' },
    });
    expect(await screen.findByText('Credencial salva.')).toBeTruthy();
  });

  it('tests a credential from the dialog', async () => {
    render(<AiSettingsTab canManage />);

    openSection(/credenciais/i);
    fireEvent.click(screen.getByRole('button', { name: /gerenciar credencial openai/i }));

    const dialog = screen.getByRole('dialog', { name: /gerenciar credencial · openai/i });
    fireEvent.change(within(dialog).getByLabelText('Chave da API'), {
      target: { value: 'sk-typed' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /testar conexão/i }));

    expect(state.test).toHaveBeenCalledWith({
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      apiKey: 'sk-typed',
    });
    expect(await screen.findByText('Conexão validada com sucesso.')).toBeTruthy();
  });

  it('requires confirmation before removing a credential', async () => {
    render(<AiSettingsTab canManage />);

    openSection(/credenciais/i);
    fireEvent.click(screen.getByRole('button', { name: /gerenciar credencial openai/i }));

    const dialog = screen.getByRole('dialog', { name: /gerenciar credencial · openai/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /remover credencial/i }));

    const confirm = screen.getByRole('dialog', {
      name: /remover credencial de openai/i,
    });
    fireEvent.click(within(confirm).getByRole('button', { name: /^remover$/i }));

    expect(state.saveCredential).toHaveBeenCalledWith({
      provider: 'OPENAI',
      input: { clearCredentials: true },
    });
    expect(await screen.findByText('Credencial removida.')).toBeTruthy();
    expect(
      screen.queryByRole('dialog', { name: /gerenciar credencial · openai/i }),
    ).toBeNull();
  });

  it('manages the credential of a provider that is not configured yet', () => {
    render(<AiSettingsTab canManage />);

    openSection(/credenciais/i);
    fireEvent.click(screen.getByRole('button', { name: /gerenciar credencial deepseek/i }));

    const dialog = screen.getByRole('dialog', { name: /gerenciar credencial · deepseek/i });
    expect(within(dialog).getByText('Credencial não configurada')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /remover credencial/i })).toBeNull();
    expect(
      (within(dialog).getByRole('button', { name: /salvar credencial/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('keeps unsaved copilot changes when navigating between sub-tabs', () => {
    render(<AiSettingsTab canManage />);

    fireEvent.click(screen.getByRole('button', { name: /provedor deepseek/i }));
    fireEvent.click(screen.getByRole('button', { name: /^formal/i }));

    openSection(/credenciais/i);
    openSection(/transcrição/i);
    openSection(/copiloto ia/i);

    expect(screen.getByRole('button', { name: /provedor deepseek/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /^formal/i }).getAttribute('aria-pressed')).toBe('true');
  });

  it('saves the independent transcription configuration', async () => {
    render(<AiSettingsTab canManage />);

    openSection(/transcrição/i);
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

    openSection(/transcrição/i);
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
});
