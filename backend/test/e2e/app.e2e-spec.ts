import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { createFastifyAdapter } from '../../src/common/http/create-fastify-adapter.js';

describe('Application (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health reports API, database and redis', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: { api: 'up', database: 'up', redis: 'up' },
    });
  });

  it('returns a stable error payload for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('echoes a safe incoming request id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'safe-request-id-1' },
    });

    expect(response.headers['x-request-id']).toBe('safe-request-id-1');
  });

  it('replaces an unsafe incoming request id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'bad value with spaces' },
    });

    const requestId = String(response.headers['x-request-id']);

    expect(requestId).not.toBe('bad value with spaces');
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
