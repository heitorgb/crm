import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const MULTIPART_MAX_BYTES = 52_428_800;

export async function registerHttpPlugins(app: NestFastifyApplication): Promise<void> {
  await app.register(fastifyHelmet);
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {
    limits: { fileSize: MULTIPART_MAX_BYTES, files: 1, fields: 5 },
  });
}
