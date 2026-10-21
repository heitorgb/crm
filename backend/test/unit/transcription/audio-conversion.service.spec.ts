import {
  AudioConversionService,
  needsAudioConversion,
} from '../../../src/modules/transcription/audio-conversion.service.js';

function service(overrides: Record<string, unknown> = {}): AudioConversionService {
  const values: Record<string, unknown> = {
    FFMPEG_PATH: 'ffmpeg',
    TRANSCRIPTION_CONVERSION_TIMEOUT_MS: 5_000,
    TRANSCRIPTION_MAX_BYTES: 25_000_000,
    ...overrides,
  };
  return new AudioConversionService({
    get: (key: string) => values[key],
  } as never);
}

describe('AudioConversionService', () => {
  it('converts the OGG/Opus containers produced by WhatsApp', () => {
    expect(needsAudioConversion('audio/ogg; codecs=opus')).toBe(true);
    expect(needsAudioConversion('audio/ogg')).toBe(true);
    expect(needsAudioConversion('audio/opus')).toBe(true);
    expect(needsAudioConversion('audio/oga')).toBe(true);
  });

  it('passes through formats already accepted by the OpenAI endpoint', async () => {
    expect(needsAudioConversion('audio/wav')).toBe(false);
    expect(needsAudioConversion('audio/mpeg')).toBe(false);
    expect(needsAudioConversion('audio/m4a')).toBe(false);
    expect(needsAudioConversion('audio/webm')).toBe(false);

    const audio = Buffer.from('wav-bytes');
    const prepared = await service().prepare({
      audio,
      mimeType: 'audio/wav',
      fileName: 'audio.wav',
    });

    expect(prepared).toEqual({
      audio,
      mimeType: 'audio/wav',
      fileName: 'audio.wav',
      converted: false,
    });
  });

  it('reports a missing ffmpeg binary as an explicit conversion failure', async () => {
    await expect(
      service({ FFMPEG_PATH: '/definitely-not-installed/ffmpeg' }).prepare({
        audio: Buffer.from('ogg-bytes'),
        mimeType: 'audio/ogg',
        fileName: 'audio.oga',
      }),
    ).rejects.toMatchObject({
      reason: 'ffmpeg_unavailable',
      name: 'AudioConversionFailure',
    });
  });
});
