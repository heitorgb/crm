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
