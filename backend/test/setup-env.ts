import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV ??= 'test';
process.env.JWT_ACCESS_SECRET ??= 'integration-test-access-secret-0000';
process.env.REFRESH_TOKEN_TTL_DAYS ??= '1';
process.env.CREDENTIALS_ENCRYPTION_KEY ??= 'integration-test-encryption-key-000000';
process.env.QUEUE_DRIVER ??= 'inline';
process.env.EVOLUTION_WEBHOOK_SECRET ??= 'test-webhook-secret';
process.env.WHATSAPP_HISTORY_IMPORT_ENABLED ??= 'true';
process.env.WHATSAPP_DISCONNECT_CONFIRM_TIMEOUT_MS ??= '1000';
process.env.PUBLIC_API_URL ??= 'http://localhost:3000';
process.env.RATE_LIMIT_ENABLED ??= 'false';
process.env.STORAGE_PROVIDER ??= 'local';
process.env.STORAGE_LOCAL_DIR ??= mkdtempSync(join(tmpdir(), 'orderup-storage-'));
process.env.MEDIA_MAX_BYTES ??= '5000000';
