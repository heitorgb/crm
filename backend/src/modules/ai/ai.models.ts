import { AiFormality, AiProvider } from '@prisma/client';

export const AI_MAX_INPUT_CHARS = 4000;
export const AI_MAX_OUTPUT_TOKENS = 4096;
export const AI_TEST_MAX_TOKENS = 24;

export interface AiModelDefinition {
  id: string;
  label: string;
  description: string;
}

export interface AiProviderDefinition {
  id: AiProvider;
  label: string;
  description: string;
  credentialLabel: string;
  models: readonly AiModelDefinition[];
}

export interface AiFormalityDefinition {
  id: AiFormality;
  label: string;
  description: string;
}

export const AI_PROVIDERS: readonly AiProviderDefinition[] = [
  {
    id: AiProvider.OPENAI,
    label: 'OpenAI',
    description: 'Modelos GPT para textos naturais e bem estruturados.',
    credentialLabel: 'Chave da API',
    models: [
      {
        id: 'gpt-6-luna',
        label: 'GPT-6 Luna',
        description: 'Rápido e econômico, ideal para alto volume.',
      },
      {
        id: 'gpt-6.1-sol',
        label: 'GPT-6.1 Sol',
        description: 'Equilíbrio entre qualidade, latência e custo.',
      },
      {
        id: 'gpt-6-astra',
        label: 'GPT-6 Astra',
        description: 'Máxima qualidade para textos mais elaborados.',
      },
    ],
  },
  {
    id: AiProvider.DEEPSEEK,
    label: 'DeepSeek',
    description: 'Modelos DeepSeek com API compatível com Chat Completions.',
    credentialLabel: 'Chave da API',
    models: [
      {
        id: 'deepseek-flash',
        label: 'DeepSeek Flash',
        description: 'Baixa latência e custo reduzido para o dia a dia.',
      },
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        description: 'Mais capacidade para textos longos e complexos.',
      },
      {
        id: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash (legado)',
        description: 'Alias legado aceito pela API e atendido pelo Flash atual.',
      },
    ],
  },
  {
    id: AiProvider.ANTHROPIC,
    label: 'Anthropic',
    description: 'Modelos Claude para textos claros, naturais e bem estruturados.',
    credentialLabel: 'Chave da API',
    models: [
      {
        id: 'claude-haiku-5-5',
        label: 'Claude Haiku 5.5',
        description: 'Mais rápido e econômico, ideal para alto volume.',
      },
      {
        id: 'claude-sonnet-5-5',
        label: 'Claude Sonnet 5.5',
        description: 'Melhor equilíbrio entre velocidade e qualidade.',
      },
      {
        id: 'claude-opus-5-5',
        label: 'Claude Opus 5.5',
        description: 'Máxima qualidade para textos mais elaborados.',
      },
    ],
  },
  {
    id: AiProvider.OPENROUTER,
    label: 'OpenRouter',
    description: 'Acesso a modelos de diferentes desenvolvedores por uma única API.',
    credentialLabel: 'Chave da API',
    models: [
      {
        id: 'anthropic/claude-haiku-5-5',
        label: 'Claude Haiku 5.5 (Anthropic)',
        description: 'Rápido e econômico para reformulação de mensagens.',
      },
      {
        id: 'openai/gpt-5.4-mini',
        label: 'GPT-5.4 Mini (OpenAI)',
        description: 'Boa qualidade e custo equilibrado para o atendimento.',
      },
      {
        id: 'google/gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash Lite (Google)',
        description: 'Baixa latência e custo reduzido para alto volume.',
      },
    ],
  },
];

export const AI_FORMALITIES: readonly AiFormalityDefinition[] = [
  {
    id: AiFormality.PROFESSIONAL,
    label: 'Profissional',
    description: 'Texto natural, cordial e claro, adequado ao atendimento cotidiano.',
  },
  {
    id: AiFormality.FORMAL,
    label: 'Formal',
    description: 'Linguagem profissional, organizada e educada.',
  },
  {
    id: AiFormality.VERY_FORMAL,
    label: 'Muito formal',
    description: 'Linguagem mais elaborada e institucional.',
  },
];

export function findProvider(provider: AiProvider): AiProviderDefinition {
  const definition = AI_PROVIDERS.find((item) => item.id === provider);
  if (!definition) {
    throw new Error(`Unknown AI provider: ${provider}`);
  }
  return definition;
}

export function isModelSupported(provider: AiProvider, model: string): boolean {
  return findProvider(provider).models.some((item) => item.id === model);
}

export function defaultModelFor(provider: AiProvider): string {
  return findProvider(provider).models[0].id;
}

export function isFormality(value: string): value is AiFormality {
  return AI_FORMALITIES.some((item) => item.id === value);
}
