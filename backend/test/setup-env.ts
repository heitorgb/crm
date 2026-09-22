process.env.NODE_ENV ??= 'test';
process.env.JWT_ACCESS_SECRET ??= 'integration-test-access-secret-0000';
process.env.CREDENTIALS_ENCRYPTION_KEY ??= 'integration-test-encryption-key-000000';
process.env.QUEUE_DRIVER ??= 'inline';
process.env.EVOLUTION_WEBHOOK_SECRET ??= 'test-webhook-secret';
process.env.PUBLIC_API_URL ??= 'http://localhost:3000';
process.env.RATE_LIMIT_ENABLED ??= 'false';
