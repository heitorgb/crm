import { OpenAiTranscriptionProvider } from '../../../src/modules/transcription/openai-transcription.provider.js';
import { TranscriptionProviderFailure } from '../../../src/modules/transcription/transcription.provider.js';

function provider(): OpenAiTranscriptionProvider {
  return new OpenAiTranscriptionProvider({
    get: vi.fn((key: string) => (key === 'TRANSCRIPTION_TIMEOUT_MS' ? 60_000 : undefined)),
  } as never);
}

function input() {
  return {
    model: 'whisper-1',
    apiKey: 'sk-secret',
    audio: Buffer.from('audio'),
    mimeType: 'audio/ogg',
    fileName: 'audio.ogg',
    language: 'pt',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiTranscriptionProvider', () => {
  it('sends multipart audio to the official endpoint and normalizes the transcript', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: '  Olá,   quero uma proposta.  ', language: 'portuguese' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().transcribe(input());

    expect(result).toEqual({
      text: 'Olá, quero uma proposta.',
      language: 'portuguese',
      provider: 'OPENAI',
      model: 'whisper-1',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('classifies authentication failures without exposing the provider body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'invalid key sk-secret' } }), {
          status: 401,
        }),
      ),
    );

    await expect(provider().transcribe(input())).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('classifies an unsupported audio container as a file problem, not a model problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'unsupported_value',
              type: 'invalid_request_error',
              param: 'file',
              message: 'Unsupported file format oga',
            },
          }),
          { status: 400 },
        ),
      ),
    );

    await expect(provider().transcribe(input())).rejects.toMatchObject({
      kind: 'file_rejected',
    });
  });

  it('classifies a genuinely unknown model as model unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'model_not_found',
              type: 'invalid_request_error',
              message: 'The model does not exist or you do not have access to it.',
            },
          }),
          { status: 404 },
        ),
      ),
    );

    await expect(provider().transcribe(input())).rejects.toMatchObject({
      kind: 'model_unavailable',
    });
  });

  it('classifies other invalid requests without blaming the model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'invalid_value',
              type: 'invalid_request_error',
              param: 'response_format',
              message: 'Invalid response format',
            },
          }),
          { status: 400 },
        ),
      ),
    );

    await expect(provider().transcribe(input())).rejects.toMatchObject({
      kind: 'invalid_request',
    });
  });

  it('rejects an empty or invalid transcript', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '   ' }), { status: 200 })),
    );

    await expect(provider().transcribe(input())).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('maps a timeout to a retryable failure kind', async () => {
    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    await expect(provider().transcribe(input())).rejects.toBeInstanceOf(
      TranscriptionProviderFailure,
    );
    await expect(provider().transcribe(input())).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('validates credential and model through the models endpoint without sending audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await provider().check({ apiKey: 'sk-secret', model: 'whisper-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models/whisper-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
