import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppException } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.validation.js';

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  size: number;
}

const MAX_INPUT_PIXELS = 100_000_000;
const execFileAsync = promisify(execFile);

export const ALLOWED_AVATAR_FORMATS = ['jpeg', 'png', 'webp'] as const;

export type AvatarFormat = (typeof ALLOWED_AVATAR_FORMATS)[number];

@Injectable()
export class MediaProcessingService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async normalizeVideo(input: Buffer): Promise<Buffer> {
    const directory = await mkdtemp(join(tmpdir(), 'orderup-video-'));
    const source = join(directory, 'source');
    const output = join(directory, 'video.mp4');
    try {
      await writeFile(source, input);
      await execFileAsync('ffmpeg', [
        '-v', 'error', '-nostdin', '-y', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart', output,
      ], { timeout: 120_000, maxBuffer: 1024 * 1024 });
      const converted = await readFile(output);
      if (converted.length > this.config.get('MEDIA_MAX_BYTES')) {
        throw new AppException('MEDIA_TOO_LARGE', 'Vídeo convertido maior que o permitido.', 413);
      }
      return converted;
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException('VIDEO_CONVERSION_FAILED', 'Não foi possível preparar o vídeo para o WhatsApp.', 422);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  /** Returns true when the buffer is a decodable image. */
  async isImage(input: Buffer): Promise<boolean> {
    try {
      const metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      return Boolean(metadata.format);
    } catch {
      return false;
    }
  }

  /** Detects the real image format from the file contents. */
  async detectImageFormat(input: Buffer): Promise<string | null> {
    try {
      const metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      return metadata.format ?? null;
    } catch {
      return null;
    }
  }

  /** Square avatar re-encoded as JPEG to keep uploads small and predictable. */
  async optimizeAvatar(input: Buffer): Promise<ProcessedImage> {
    const dimension = this.config.get('AVATAR_DIMENSION');
    const quality = this.config.get('MEDIA_IMAGE_QUALITY');

    const buffer = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' })
      .rotate()
      .resize({ width: dimension, height: dimension, fit: 'cover', position: 'centre' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    const metadata = await sharp(buffer).metadata();

    return {
      buffer,
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      size: buffer.length,
    };
  }

  /** Resizes/re-encodes an image to a reduced JPEG (strips metadata). */
  async optimizeImage(input: Buffer): Promise<ProcessedImage> {
    const maxDimension = this.config.get('MEDIA_IMAGE_MAX_DIMENSION');
    const quality = this.config.get('MEDIA_IMAGE_QUALITY');

    const buffer = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' })
      .rotate()
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    const metadata = await sharp(buffer).metadata();

    return {
      buffer,
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      size: buffer.length,
    };
  }

  /** Smaller JPEG used for fast previews. */
  async makeThumbnail(input: Buffer): Promise<ProcessedImage> {
    const dimension = this.config.get('MEDIA_THUMBNAIL_DIMENSION');
    const quality = this.config.get('MEDIA_IMAGE_QUALITY');

    const buffer = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' })
      .rotate()
      .resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    const metadata = await sharp(buffer).metadata();

    return {
      buffer,
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      size: buffer.length,
    };
  }
}
