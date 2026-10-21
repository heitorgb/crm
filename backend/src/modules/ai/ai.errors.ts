import { AppException } from '../../common/errors/app.exception.js';

export class AiNotConfiguredError extends AppException {
  constructor() {
    super(
      'AI_NOT_CONFIGURED',
      'A inteligência artificial ainda não está configurada para esta organização.',
      409,
    );
  }
}

export class AiDisabledError extends AppException {
  constructor() {
    super('AI_DISABLED', 'A inteligência artificial está desativada para esta organização.', 409);
  }
}

export class AiCredentialsRequiredError extends AppException {
  constructor() {
    super('AI_CREDENTIALS_REQUIRED', 'Informe uma credencial válida para o provedor de IA.', 400);
  }
}

export class AiModelNotSupportedError extends AppException {
  constructor() {
    super('AI_MODEL_NOT_SUPPORTED', 'O modelo selecionado não é compatível com o provedor.', 400);
  }
}

export class AiEncryptionUnavailableError extends AppException {
  constructor() {
    super(
      'AI_ENCRYPTION_UNAVAILABLE',
      'O armazenamento seguro de credenciais não está configurado no servidor.',
      503,
    );
  }
}

export class AiCredentialsUnreadableError extends AppException {
  constructor() {
    super(
      'AI_CREDENTIALS_UNREADABLE',
      'Não foi possível ler a credencial de IA. Salve a credencial novamente.',
      409,
    );
  }
}

export class AiRequestInProgressError extends AppException {
  constructor() {
    super('AI_REQUEST_IN_PROGRESS', 'Já existe uma formalização em andamento.', 409);
  }
}

export class AiProviderAuthError extends AppException {
  constructor() {
    super('AI_PROVIDER_AUTH_FAILED', 'O provedor de IA recusou a credencial configurada.', 502);
  }
}

export class AiProviderRateLimitError extends AppException {
  constructor() {
    super(
      'AI_PROVIDER_RATE_LIMITED',
      'O provedor de IA atingiu o limite de requisições. Tente novamente em instantes.',
      429,
    );
  }
}

export class AiProviderQuotaError extends AppException {
  constructor() {
    super('AI_PROVIDER_QUOTA_EXCEEDED', 'A cota ou o saldo do provedor de IA é insuficiente.', 402);
  }
}

export class AiProviderModelUnavailableError extends AppException {
  constructor() {
    super(
      'AI_MODEL_UNAVAILABLE',
      'O modelo selecionado não está disponível no provedor de IA.',
      502,
    );
  }
}

export class AiProviderTimeoutError extends AppException {
  constructor() {
    super('AI_PROVIDER_TIMEOUT', 'O provedor de IA demorou demais para responder.', 504);
  }
}

export class AiProviderUnavailableError extends AppException {
  constructor() {
    super(
      'AI_PROVIDER_UNAVAILABLE',
      'Não foi possível conectar ao provedor de IA. Tente novamente.',
      502,
    );
  }
}

export class AiProviderInvalidResponseError extends AppException {
  constructor() {
    super(
      'AI_PROVIDER_INVALID_RESPONSE',
      'O provedor de IA retornou uma resposta inválida. Tente novamente.',
      502,
    );
  }
}

export class AiSalesConversationMismatchError extends AppException {
  constructor() {
    super(
      'AI_SALES_CONVERSATION_MISMATCH',
      'A conversa selecionada não pertence ao contato desta oportunidade.',
      404,
    );
  }
}

export class AiSalesRequestInProgressError extends AppException {
  constructor() {
    super('AI_SALES_REQUEST_IN_PROGRESS', 'Já existe uma análise comercial em andamento.', 409);
  }
}

export class AiSalesInvalidResponseError extends AppException {
  constructor() {
    super(
      'AI_SALES_INVALID_RESPONSE',
      'A IA não retornou uma análise comercial válida. Tente novamente.',
      502,
    );
  }
}

export class AiSalesReplyInvalidResponseError extends AppException {
  constructor() {
    super(
      'AI_SALES_INVALID_RESPONSE',
      'A IA não retornou uma resposta comercial válida. Tente novamente.',
      502,
    );
  }
}

export class AiSalesRecommendationNotFoundError extends AppException {
  constructor() {
    super('AI_SALES_RECOMMENDATION_NOT_FOUND', 'Recomendação comercial não encontrada.', 404);
  }
}

export class AiSalesRecommendationInvalidStateError extends AppException {
  constructor() {
    super(
      'AI_SALES_RECOMMENDATION_INVALID_STATE',
      'Esta recomendação já foi decidida e não pode ser alterada.',
      409,
    );
  }
}

export class AiSalesRecommendationInvalidStageError extends AppException {
  constructor() {
    super(
      'AI_SALES_RECOMMENDATION_INVALID_STAGE',
      'A etapa sugerida não existe no pipeline desta oportunidade.',
      400,
    );
  }
}

export class AiSalesLeadUpdateTooLargeError extends AppException {
  constructor() {
    super(
      'AI_SALES_LEAD_UPDATE_TOO_LARGE',
      'A atualização deixaria as observações da oportunidade acima do limite permitido.',
      400,
    );
  }
}

export class AiSalesFollowUpNotFoundError extends AppException {
  constructor() {
    super('AI_SALES_FOLLOW_UP_NOT_FOUND', 'Acompanhamento não encontrado.', 404);
  }
}

export class AiSalesFollowUpInvalidStateError extends AppException {
  constructor() {
    super(
      'AI_SALES_FOLLOW_UP_INVALID_STATE',
      'Este acompanhamento já foi concluído ou cancelado.',
      409,
    );
  }
}

export class AiSalesFollowUpOwnerNotFoundError extends AppException {
  constructor() {
    super('AI_SALES_FOLLOW_UP_OWNER_NOT_FOUND', 'Responsável não encontrado.', 404);
  }
}
