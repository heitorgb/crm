import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function normalizeRequestId(candidate: unknown): string {
  if (typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)) {
    return candidate;
  }

  return randomUUID();
}
