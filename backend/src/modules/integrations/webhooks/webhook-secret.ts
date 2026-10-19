import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET_PREFIX = 'whk_';
const SECRET_BYTES = 32;
const HINT_LENGTH = 4;

export interface GeneratedWebhookSecret {
  secret: string;
  hash: string;
  hint: string;
}

export function generateWebhookSecret(): GeneratedWebhookSecret {
  const secret = `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return {
    secret,
    hash: hashWebhookSecret(secret),
    hint: secret.slice(-HINT_LENGTH),
  };
}

export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function webhookSecretMatches(provided: string, expectedHash: string): boolean {
  const providedHash = Buffer.from(hashWebhookSecret(provided), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  if (providedHash.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(providedHash, expected);
}

export function extractWebhookSecret(
  authorizationHeader: string | undefined,
  secretHeader: string | undefined,
): string | null {
  if (secretHeader && secretHeader.trim().length > 0) {
    return secretHeader.trim();
  }
  if (!authorizationHeader) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match?.[1]?.trim() || null;
}
