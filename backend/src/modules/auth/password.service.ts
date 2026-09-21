import { Injectable } from '@nestjs/common';
import { hash, verify, type Algorithm } from '@node-rs/argon2';

const ARGON2ID = 2 as Algorithm;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plain, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }
}
