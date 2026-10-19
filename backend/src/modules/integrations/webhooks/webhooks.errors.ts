import { AppException } from '../../../common/errors/app.exception.js';

export class WebhookIntegrationNotFoundError extends AppException {
  constructor() {
    super('WEBHOOK_INTEGRATION_NOT_FOUND', 'Integração de webhook não encontrada.', 404);
  }
}

export class WebhookIntegrationInactiveError extends AppException {
  constructor() {
    super('WEBHOOK_INTEGRATION_INACTIVE', 'A integração de webhook está inativa.', 409);
  }
}

export class WebhookUnauthorizedError extends AppException {
  constructor() {
    super('WEBHOOK_UNAUTHORIZED', 'Credencial do webhook inválida.', 401);
  }
}

export class WebhookMessageRequiredError extends AppException {
  constructor() {
    super('WEBHOOK_MESSAGE_REQUIRED', 'O campo message é obrigatório.', 400);
  }
}

export class WebhookGroupInvalidError extends AppException {
  constructor(message = 'O destino deve ser um grupo do WhatsApp (@g.us).') {
    super('WEBHOOK_GROUP_INVALID', message, 400);
  }
}

export class WebhookGroupNotFoundError extends AppException {
  constructor() {
    super(
      'WEBHOOK_GROUP_NOT_FOUND',
      'O grupo informado não foi encontrado na instância do WhatsApp.',
      400,
    );
  }
}

export class WebhookInstanceUnavailableError extends AppException {
  constructor(message = 'A instância do WhatsApp está inativa ou desconectada.') {
    super('WEBHOOK_INSTANCE_UNAVAILABLE', message, 409);
  }
}

export class WebhookProviderError extends AppException {
  constructor(executionId: string, providerStatus?: number) {
    super(
      'WEBHOOK_PROVIDER_ERROR',
      'Não foi possível enviar a mensagem pelo WhatsApp.',
      502,
      { executionId, providerStatus: providerStatus ?? null },
    );
  }
}

export class WebhookProviderUnavailableError extends AppException {
  constructor(executionId: string) {
    super(
      'WEBHOOK_PROVIDER_UNAVAILABLE',
      'A Evolution API não está configurada ou indisponível.',
      503,
      { executionId },
    );
  }
}

export class WebhookRecordingFailedError extends AppException {
  constructor(executionId: string) {
    super(
      'WEBHOOK_RECORDING_FAILED',
      'A mensagem foi aceita pelo WhatsApp, mas não pôde ser registrada na conversa.',
      500,
      { executionId },
    );
  }
}

export class WebhookExecutionInProgressError extends AppException {
  constructor(executionId: string) {
    super(
      'WEBHOOK_EXECUTION_IN_PROGRESS',
      'Uma execução com esta chave de idempotência ainda está em andamento.',
      409,
      { executionId },
    );
  }
}

export class WebhookExecutionFailedError extends AppException {
  constructor(executionId: string) {
    super(
      'WEBHOOK_EXECUTION_FAILED',
      'A execução anterior com esta chave de idempotência falhou.',
      502,
      { executionId },
    );
  }
}

export class WebhookIdempotencyKeyInvalidError extends AppException {
  constructor() {
    super(
      'WEBHOOK_IDEMPOTENCY_KEY_INVALID',
      'O cabeçalho Idempotency-Key deve ter no máximo 200 caracteres.',
      400,
    );
  }
}
