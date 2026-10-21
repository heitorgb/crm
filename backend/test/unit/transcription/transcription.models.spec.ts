import { AiProvider } from '@prisma/client';
import {
  defaultTranscriptionModel,
  isSupportedAudioMime,
  isTranscriptionModelSupported,
  isTranscriptionProviderSupported,
  TRANSCRIPTION_PROVIDERS,
} from '../../../src/modules/transcription/transcription.models.js';

describe('transcription catalog', () => {
  it('supports only OpenAI for speech-to-text and says why the others do not', () => {
    expect(isTranscriptionProviderSupported(AiProvider.OPENAI)).toBe(true);
    for (const provider of [
      AiProvider.DEEPSEEK,
      AiProvider.ANTHROPIC,
      AiProvider.OPENROUTER,
    ]) {
      const definition = TRANSCRIPTION_PROVIDERS.find((item) => item.id === provider);
      expect(definition?.supported).toBe(false);
      expect(definition?.unsupportedReason).toBeTruthy();
      expect(definition?.models).toHaveLength(0);
    }
  });

  it('accepts exactly the three official OpenAI identifiers exposed by the catalog', () => {
    for (const model of ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe']) {
      expect(isTranscriptionModelSupported(AiProvider.OPENAI, model)).toBe(true);
    }
    expect(isTranscriptionModelSupported(AiProvider.OPENAI, 'gpt-6-luna')).toBe(false);
    expect(isTranscriptionModelSupported(AiProvider.OPENAI, 'gpt-transcribe')).toBe(false);
    expect(isTranscriptionModelSupported(AiProvider.DEEPSEEK, 'whisper-1')).toBe(false);
    expect(defaultTranscriptionModel(AiProvider.OPENAI)).toBe('whisper-1');
    expect(
      TRANSCRIPTION_PROVIDERS.find((item) => item.id === AiProvider.OPENAI)?.models.map(
        (item) => item.id,
      ),
    ).toEqual(['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe']);
  });

  it('accepts the audio containers produced by WhatsApp', () => {
    expect(isSupportedAudioMime('audio/ogg; codecs=opus')).toBe(true);
    expect(isSupportedAudioMime('audio/opus')).toBe(true);
    expect(isSupportedAudioMime('audio/mpeg')).toBe(true);
    expect(isSupportedAudioMime('video/mp4')).toBe(false);
    expect(isSupportedAudioMime('application/octet-stream')).toBe(false);
  });
});
