import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { normalizeAudioMime } from './transcription.models.js';

const OPENAI_SUPPORTED_AUDIO_MIME_TYPES = new Set([
  'audio/m4a',
  'audio/mp3',
  'audio/mp4',
  'audio/mpeg',
  'audio/mpga',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
]);

export type AudioConversionFailureReason =
  | 'ffmpeg_unavailable'
  | 'timeout'
  | 'too_large'
  | 'conversion_failed';

export class AudioConversionFailure extends Error {
  constructor(
    readonly reason: AudioConversionFailureReason,
    message = reason,
  ) {
    super(message);
    this.name = 'AudioConversionFailure';
  }
}

export interface AudioToPrepare {
  audio: Buffer;
  mimeType: string;
  fileName: string;
}

export interface PreparedAudio {
  audio: Buffer;
  mimeType: string;
  fileName: string;
  converted: boolean;
}

export function needsAudioConversion(mimeType: string): boolean {
  return !OPENAI_SUPPORTED_AUDIO_MIME_TYPES.has(normalizeAudioMime(mimeType));
}

@Injectable()
export class AudioConversionService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async prepare(input: AudioToPrepare): Promise<PreparedAudio> {
    if (!needsAudioConversion(input.mimeType)) {
      return { ...input, converted: false };
    }

    const audio = await this.convertToWav(input.audio);
    return {
      audio,
      mimeType: 'audio/wav',
      fileName: `${fileNameWithoutExtension(input.fileName)}.wav`,
      converted: true,
    };
  }

  private convertToWav(input: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-f',
          'wav',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const chunks: Buffer[] = [];
      const maxBytes = this.maxOutputBytes;
      let total = 0;
      let settled = false;

      const finish = (error: Error | null, value?: Buffer): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve(value as Buffer);
        }
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new AudioConversionFailure('timeout'));
      }, this.timeoutMs);
      timer.unref?.();

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(
          new AudioConversionFailure(
            error.code === 'ENOENT' ? 'ffmpeg_unavailable' : 'conversion_failed',
          ),
        );
      });
      child.on('close', (code) => {
        if (code === 0) {
          finish(null, Buffer.concat(chunks));
        } else {
          finish(new AudioConversionFailure('conversion_failed'));
        }
      });
      child.stdout.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          child.kill('SIGKILL');
          finish(new AudioConversionFailure('too_large'));
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on('data', () => undefined);
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
    });
  }

  private get ffmpegPath(): string {
    return this.config.get('FFMPEG_PATH');
  }

  private get timeoutMs(): number {
    return this.config.get('TRANSCRIPTION_CONVERSION_TIMEOUT_MS');
  }

  private get maxOutputBytes(): number {
    return this.config.get('TRANSCRIPTION_MAX_BYTES');
  }
}

function fileNameWithoutExtension(fileName: string): string {
  const base = fileName.replace(/[^\w.\- ]/g, '_').trim() || 'audio';
  return base.replace(/\.[^.]+$/, '') || 'audio';
}
