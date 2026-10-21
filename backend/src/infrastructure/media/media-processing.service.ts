import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
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

export const ALLOWED_AVATAR_FORMATS = ['jpeg', 'png', 'webp'] as const;

export type AvatarFormat = (typeof ALLOWED_AVATAR_FORMATS)[number];

@Injectable()
export class MediaProcessingService {
  constructor(private readonly config: ConfigService<Env, true>) {}

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
