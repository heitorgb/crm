import { validateEnv } from '../../../src/config/env.validation.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults for optional variables', () => {
    const env = validateEnv({ ...baseEnv });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.AI_TIMEOUT_MS).toBe(30000);
    expect(env.AI_MAX_RETRIES).toBe(2);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(env.AUTH_COOKIE_SAMESITE).toBe('lax');
    expect(env.AUTH_COOKIE_SECURE).toBeUndefined();
  });

  it('requires JWT_ACCESS_SECRET', () => {
    const { JWT_ACCESS_SECRET: _secret, ...rest } = baseEnv;

    expect(() => validateEnv(rest)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a short JWT_ACCESS_SECRET', () => {
    expect(() => validateEnv({ ...baseEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('parses AUTH_COOKIE_SECURE as a boolean', () => {
    expect(validateEnv({ ...baseEnv, AUTH_COOKIE_SECURE: 'true' }).AUTH_COOKIE_SECURE).toBe(true);
    expect(validateEnv({ ...baseEnv, AUTH_COOKIE_SECURE: 'false' }).AUTH_COOKIE_SECURE).toBe(false);
  });

  it('requires a secure cookie when SameSite is none', () => {
    expect(() => validateEnv({ ...baseEnv, AUTH_COOKIE_SAMESITE: 'none' })).toThrow(
      /AUTH_COOKIE_SECURE/,
    );
    expect(
      validateEnv({
        ...baseEnv,
        AUTH_COOKIE_SAMESITE: 'none',
        AUTH_COOKIE_SECURE: 'true',
      }).AUTH_COOKIE_SAMESITE,
    ).toBe('none');
  });

  it('coerces PORT from string to number', () => {
    const env = validateEnv({ ...baseEnv, PORT: '4000' });

    expect(env.PORT).toBe(4000);
  });

  it('parses CORS_ORIGINS into a trimmed list', () => {
    const env = validateEnv({
      ...baseEnv,
      CORS_ORIGINS: 'https://a.com, https://b.com ,',
    });

    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('throws when required variables are missing', () => {
    expect(() => validateEnv({ REDIS_URL: baseEnv.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('treats empty optional variables as absent', () => {
    const env = validateEnv({
      ...baseEnv,
      AI_PROVIDER: '',
      AI_MODEL: '',
      AI_API_KEY: '',
      AI_BASE_URL: '',
    });

    expect(env.AI_PROVIDER).toBeUndefined();
    expect(env.AI_BASE_URL).toBeUndefined();
  });

  it('requires model and api key when a provider is configured', () => {
    expect(() => validateEnv({ ...baseEnv, AI_PROVIDER: 'openai' })).toThrow(
      /AI_MODEL and AI_API_KEY/,
    );
  });

  it('accepts a complete AI configuration', () => {
    const env = validateEnv({
      ...baseEnv,
      AI_PROVIDER: 'openai',
      AI_MODEL: 'gpt-4o-mini',
      AI_API_KEY: 'secret',
      AI_BASE_URL: 'https://api.openai.com/v1',
    });

    expect(env.AI_PROVIDER).toBe('openai');
    expect(env.AI_BASE_URL).toBe('https://api.openai.com/v1');
  });

  it('rejects wildcard CORS in production', () => {
    expect(() =>
      validateEnv({ ...baseEnv, NODE_ENV: 'production', CORS_ORIGINS: '*' }),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('accepts explicit CORS origins in production', () => {
    const env = validateEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.orderup.com.br',
    });

    expect(env.CORS_ORIGINS).toEqual(['https://app.orderup.com.br']);
  });

  it('requires API key and webhook secret when WhatsApp is enabled', () => {
    expect(() =>
      validateEnv({ ...baseEnv, EVOLUTION_API_BASE_URL: 'https://evolution.local' }),
    ).toThrow(/EVOLUTION_API_KEY/);

    expect(() =>
      validateEnv({
        ...baseEnv,
        EVOLUTION_API_BASE_URL: 'https://evolution.local',
        EVOLUTION_API_KEY: 'key',
      }),
    ).toThrow(/EVOLUTION_WEBHOOK_SECRET/);
  });

  it('requires the encryption key in production when WhatsApp is enabled', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.orderup.com.br',
        EVOLUTION_API_BASE_URL: 'https://evolution.local',
        EVOLUTION_API_KEY: 'key',
        EVOLUTION_WEBHOOK_SECRET: 'secret',
      }),
    ).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('requires the full storage configuration when a provider is set', () => {
    expect(() => validateEnv({ ...baseEnv, STORAGE_PROVIDER: 'minio' })).toThrow(
      /Missing storage configuration/,
    );

    const env = validateEnv({
      ...baseEnv,
      STORAGE_PROVIDER: 'minio',
      STORAGE_ENDPOINT: 'http://minio:9000',
      STORAGE_BUCKET: 'orderup',
      STORAGE_ACCESS_KEY: 'access',
      STORAGE_SECRET_KEY: 'secret',
    });
    expect(env.STORAGE_PROVIDER).toBe('minio');
  });

  it('parses RATE_LIMIT_ENABLED as a boolean with default enabled', () => {
    expect(validateEnv({ ...baseEnv }).RATE_LIMIT_ENABLED).toBeUndefined();
    expect(validateEnv({ ...baseEnv, RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED).toBe(false);
    expect(validateEnv({ ...baseEnv, RATE_LIMIT_ENABLED: 'true' }).RATE_LIMIT_ENABLED).toBe(true);
  });
});
