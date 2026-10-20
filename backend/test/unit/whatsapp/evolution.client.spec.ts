import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import { EvolutionClient } from '../../../src/modules/whatsapp/evolution/evolution.client.js';
import type { PlatformSettingsService } from '../../../src/modules/platform-settings/platform-settings.service.js';

interface PlatformSettingsMock {
  isLinkPreviewsEnabled: ReturnType<typeof vi.fn>;
}

function createClient(): {
  client: EvolutionClient;
  platformSettings: PlatformSettingsMock;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const config = {
    get: (key: string) =>
      key === 'EVOLUTION_API_BASE_URL'
        ? 'http://evolution.local'
        : key === 'EVOLUTION_API_KEY'
          ? 'secret'
          : undefined,
  } as unknown as ConfigService<Env, true>;
  const platformSettings: PlatformSettingsMock = {
    isLinkPreviewsEnabled: vi.fn().mockResolvedValue(false),
  };
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ key: { id: 'external-1' } }),
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    client: new EvolutionClient(config, platformSettings as unknown as PlatformSettingsService),
    platformSettings,
    fetchMock,
  };
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EvolutionClient.sendText link preview', () => {
  it('forces linkPreview false when the global setting is disabled', async () => {
    const { client, fetchMock } = createClient();

    await client.sendText('instance-1', '5511999999999', 'Veja https://exemplo.com', undefined, {
      linkPreview: true,
    });

    expect(sentBody(fetchMock)).toEqual({
      number: '5511999999999',
      text: 'Veja https://exemplo.com',
      linkPreview: false,
    });
  });

  it('allows the preview when globally enabled and the caller asks for it', async () => {
    const { client, platformSettings, fetchMock } = createClient();
    platformSettings.isLinkPreviewsEnabled.mockResolvedValue(true);

    await client.sendText('instance-1', '5511999999999', 'Veja https://exemplo.com', undefined, {
      linkPreview: true,
    });

    expect(sentBody(fetchMock)).toMatchObject({ linkPreview: true });
  });

  it('keeps an explicit per-message suppression when globally enabled', async () => {
    const { client, platformSettings, fetchMock } = createClient();
    platformSettings.isLinkPreviewsEnabled.mockResolvedValue(true);

    await client.sendText('instance-1', '5511999999999', 'Veja https://exemplo.com', undefined, {
      linkPreview: false,
    });

    expect(sentBody(fetchMock)).toMatchObject({ linkPreview: false });
  });

  it('omits the option when globally enabled and the caller has no preference', async () => {
    const { client, platformSettings, fetchMock } = createClient();
    platformSettings.isLinkPreviewsEnabled.mockResolvedValue(true);

    await client.sendText('instance-1', '5511999999999', 'Olá');

    expect(sentBody(fetchMock)).not.toHaveProperty('linkPreview');
  });
});
