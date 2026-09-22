import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../config/env.validation.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

@Injectable()
export class EncryptionService {
  private readonly key?: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('CREDENTIALS_ENCRYPTION_KEY');
    this.key = secret ? createHash('sha256').update(secret).digest() : undefined;
  }

  get available(): boolean {
    return this.key !== undefined;
  }

  encrypt(plainText: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(
      ':',
    );
  }

  decrypt(payload: string): string {
    const key = this.requireKey();
    const [version, ivPart, tagPart, dataPart] = payload.split(':');

    if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
      throw new Error('Invalid encrypted payload');
    }

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY is not configured');
    }
    return this.key;
  }
}
