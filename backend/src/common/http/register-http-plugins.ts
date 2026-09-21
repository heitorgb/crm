import fastifyCookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export async function registerHttpPlugins(app: NestFastifyApplication): Promise<void> {
  await app.register(helmet);
  await app.register(fastifyCookie);
}
