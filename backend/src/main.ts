import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { createFastifyAdapter } from './common/http/create-fastify-adapter.js';
import { registerHttpPlugins } from './common/http/register-http-plugins.js';
import type { Env } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  await registerHttpPlugins(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix(config.getOrThrow('API_PREFIX'));
  app.enableCors({ origin: config.getOrThrow('CORS_ORIGINS'), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const port = config.getOrThrow('PORT');
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start application', error);
  process.exitCode = 1;
});
