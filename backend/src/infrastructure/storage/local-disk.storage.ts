import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import type { StorageService } from './storage.types.js';

@Injectable()
export class LocalDiskStorage implements StorageService {
  private readonly baseDir: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseDir = resolve(config.get('STORAGE_LOCAL_DIR') ?? './storage');
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolveKey(key)).catch(() => undefined);
  }

  private resolveKey(key: string): string {
    const target = resolve(this.baseDir, key);
    if (target !== this.baseDir && !target.startsWith(`${this.baseDir}${sep}`)) {
      throw new Error('Invalid storage key');
    }
    return target;
  }
}
