import sharp from 'sharp';
import { MediaProcessingService } from '../../../src/infrastructure/media/media-processing.service.js';

function makeService(): MediaProcessingService {
  const values: Record<string, number> = {
    MEDIA_IMAGE_MAX_DIMENSION: 1600,
    MEDIA_IMAGE_QUALITY: 80,
    MEDIA_THUMBNAIL_DIMENSION: 256,
  };
  const config = { get: (key: string) => values[key] };
  return new MediaProcessingService(config as never);
}

describe('MediaProcessingService', () => {
  it('resizes and re-encodes to jpeg', async () => {
    const service = makeService();
    const input = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#0000ff' },
    })
      .png()
      .toBuffer();

    const optimized = await service.optimizeImage(input);

    expect(optimized.mimeType).toBe('image/jpeg');
    expect(optimized.width).toBeLessThanOrEqual(1600);
    expect(optimized.height).toBeLessThanOrEqual(1600);
    expect(optimized.size).toBeLessThan(input.length);
    expect(await service.isImage(optimized.buffer)).toBe(true);
  });

  it('creates a smaller thumbnail', async () => {
    const service = makeService();
    const input = await sharp({
      create: { width: 2000, height: 1200, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    const thumbnail = await service.makeThumbnail(input);

    expect(thumbnail.width).toBeLessThanOrEqual(256);
    expect(thumbnail.height).toBeLessThanOrEqual(256);
  });

  it('rejects non-image buffers', async () => {
    const service = makeService();
    expect(await service.isImage(Buffer.from('not an image'))).toBe(false);
  });
});
