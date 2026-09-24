import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import type { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from '../../../../src/common/errors/all-exceptions.filter.js';
import { AppException } from '../../../../src/common/errors/app.exception.js';

interface Harness {
  filter: AllExceptionsFilter;
  host: ArgumentsHost;
  send: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  logger: { setContext: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function createHarness(): Harness {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const reply = { status } as unknown as FastifyReply;
  const host = { switchToHttp: () => ({ getResponse: () => reply }) } as unknown as ArgumentsHost;
  const logger = { setContext: vi.fn(), error: vi.fn() };
  const filter = new AllExceptionsFilter(logger as unknown as PinoLogger);

  return { filter, host, send, status, logger };
}

describe('AllExceptionsFilter', () => {
  it('maps AppException to its stable payload', () => {
    const { filter, host, send } = createHarness();
    const exception = new AppException('CUSTOM_ERROR', 'Something failed', 422, { field: 'x' });

    filter.catch(exception, host);

    expect(send).toHaveBeenCalledWith({
      statusCode: 422,
      code: 'CUSTOM_ERROR',
      message: 'Something failed',
      details: { field: 'x' },
    });
  });

  it('maps Nest HttpException to a stable code', () => {
    const { filter, host, send } = createHarness();

    filter.catch(new NotFoundException('Not here'), host);

    expect(send).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Not here',
      details: null,
    });
  });

  it('joins validation messages from HttpException responses', () => {
    const { filter, host, send } = createHarness();

    filter.catch(new BadRequestException(['name is required', 'age must be a number']), host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'name is required, age must be a number',
      }),
    );
  });

  it('maps known Prisma errors without leaking internals', () => {
    const { filter, host, send } = createHarness();
    const exception = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: 'test' },
    );

    filter.catch(exception, host);

    expect(send).toHaveBeenCalledWith({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Resource already exists',
      details: null,
    });
  });

  it('hides unknown errors and logs them', () => {
    const { filter, host, send, logger } = createHarness();

    filter.catch(new Error('connection string leaked'), host);

    expect(send).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: null,
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
