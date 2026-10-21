import { AiProvider } from '@prisma/client';

export const TRANSCRIPTION_MAX_TEXT_CHARS = 20_000;

export interface TranscriptionModelDefinition {
  id: string;
  label: string;
  description: string;
}

export interface TranscriptionProviderDefinition {
  id: AiProvider;
  label: string;
  description: string;
  supported: boolean;
  unsupportedReason: string | null;
  models: readonly TranscriptionModelDefinition[];
}

export const TRANSCRIPTION_PROVIDERS: readonly TranscriptionProviderDefinition[] = [
  {
    id: AiProvider.OPENAI,
    label: 'OpenAI',
    description: 'Transcrição pela API oficial de áudio da OpenAI.',
    supported: true,
    unsupportedReason: null,
    models: [
      {
        id: 'whisper-1',
        label: 'Whisper',
        description: 'Modelo consolidado, econômico e compatível com os áudios do WhatsApp.',
      },
      {
        id: 'gpt-4o-mini-transcribe',
        label: 'GPT-4o Mini Transcribe',
        description: 'Melhor custo-benefício para transcrições curtas e frequentes.',
      },
      {
        id: 'gpt-4o-transcribe',
        label: 'GPT-4o Transcribe',
        description: 'Maior precisão em áudios com ruído, sotaques ou fala sobreposta.',
      },
    ],
  },
  {
    id: AiProvider.DEEPSEEK,
    label: 'DeepSeek',
    description: 'A API DeepSeek disponível no CRM oferece apenas modelos de texto.',
    supported: false,
    unsupportedReason: 'O DeepSeek não oferece endpoint oficial de transcrição de áudio.',
    models: [],
  },
  {
    id: AiProvider.ANTHROPIC,
    label: 'Anthropic',
    description: 'A API Anthropic disponível no CRM oferece apenas modelos de texto.',
    supported: false,
    unsupportedReason: 'A Anthropic não oferece endpoint oficial de transcrição de áudio.',
    models: [],
  },
  {
    id: AiProvider.OPENROUTER,
    label: 'OpenRouter',
    description: 'O OpenRouter é usado no CRM como acesso a modelos de texto.',
    supported: false,
    unsupportedReason:
      'O OpenRouter não oferece endpoint de transcrição compatível com esta integração.',
    models: [],
  },
];

export const TRANSCRIPTION_SUPPORTED_MIME_TYPES = new Set([
  'audio/flac',
  'audio/m4a',
  'audio/mp3',
  'audio/mp4',
  'audio/mpeg',
  'audio/mpga',
  'audio/oga',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav',
]);

export function findTranscriptionProvider(provider: AiProvider): TranscriptionProviderDefinition {
  const definition = TRANSCRIPTION_PROVIDERS.find((item) => item.id === provider);
  if (!definition) {
    throw new Error(`Unknown transcription provider: ${provider}`);
  }
  return definition;
}

export function isTranscriptionProviderSupported(provider: AiProvider): boolean {
  return findTranscriptionProvider(provider).supported;
}

export function isTranscriptionModelSupported(provider: AiProvider, model: string): boolean {
  return findTranscriptionProvider(provider).models.some((item) => item.id === model);
}

export function defaultTranscriptionModel(provider: AiProvider): string {
  return findTranscriptionProvider(provider).models[0]?.id ?? 'whisper-1';
}

export function normalizeAudioMime(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

export function isSupportedAudioMime(mimeType: string): boolean {
  return TRANSCRIPTION_SUPPORTED_MIME_TYPES.has(normalizeAudioMime(mimeType));
}

export function audioExtensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/flac': 'flac',
    'audio/m4a': 'm4a',
    'audio/mp3': 'mp3',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/mpga': 'mpga',
    'audio/oga': 'oga',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/x-m4a': 'm4a',
    'audio/x-wav': 'wav',
  };
  return map[normalizeAudioMime(mimeType)] ?? 'ogg';
}
