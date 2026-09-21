import { z } from 'zod';

const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value: unknown) => (value === '' ? undefined : value), schema.optional());

const optionalBoolean = z.preprocess((value: unknown) => {
  if (value === '' || value === undefined || value === null) {
    return undefined;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
}, z.boolean().optional());

const appEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().min(1).default('api'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
});

const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
});

const redisEnvSchema = z.object({
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
});

// AUTH
const authEnvSchema = z.object({
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_COOKIE_SECURE: optionalBoolean,
  AUTH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  AUTH_COOKIE_DOMAIN: optionalEnv(z.string().min(1)),
});

// LOGGING
const loggingEnvSchema = z.object({
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const aiEnvSchema = z.object({
  AI_PROVIDER: optionalEnv(z.string().min(1)),
  AI_MODEL: optionalEnv(z.string().min(1)),
  AI_API_KEY: optionalEnv(z.string().min(1)),
  AI_BASE_URL: optionalEnv(z.url()),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
});

export const envSchema = appEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(authEnvSchema)
  .merge(loggingEnvSchema)
  .merge(aiEnvSchema)
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER && (!env.AI_MODEL || !env.AI_API_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'AI_MODEL and AI_API_KEY are required when AI_PROVIDER is set',
      });
    }

    if (env.AUTH_COOKIE_SAMESITE === 'none' && env.AUTH_COOKIE_SECURE !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SAMESITE'],
        message: 'AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAMESITE is "none"',
      });
    }

    if (env.NODE_ENV === 'production') {
      if (env.CORS_ORIGINS.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'CORS_ORIGINS must be set in production',
        });
      }

      if (env.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'CORS_ORIGINS must not contain "*" in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
