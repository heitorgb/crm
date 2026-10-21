import { AppException } from '../../common/errors/app.exception.js';

export class TranscriptionProviderUnsupportedError extends AppException {
  constructor(reason?: string) {
    super(
      'AI_TRANSCRIPTION_PROVIDER_UNSUPPORTED',
      reason ?? 'O provedor selecionado não oferece suporte a transcrição de áudio.',
      400,
    );
  }
}

export class TranscriptionModelNotSupportedError extends AppException {
  constructor() {
    super(
      'AI_TRANSCRIPTION_MODEL_NOT_SUPPORTED',
      'O modelo selecionado não é compatível com a transcrição de áudio.',
      400,
    );
  }
}

export class TranscriptionCredentialsRequiredError extends AppException {
  constructor() {
    super(
      'AI_TRANSCRIPTION_CREDENTIALS_REQUIRED',
      'Configure a credencial da OpenAI antes de ativar a transcrição de áudio.',
      400,
    );
  }
}

export class TranscriptionEncryptionUnavailableError extends AppException {
  constructor() {
    super(
      'AI_TRANSCRIPTION_ENCRYPTION_UNAVAILABLE',
      'O armazenamento seguro de credenciais não está configurado no servidor.',
      503,
    );
  }
}

export class TranscriptionCredentialsUnreadableError extends AppException {
  constructor() {
    super(
      'AI_TRANSCRIPTION_CREDENTIALS_UNREADABLE',
      'Não foi possível ler a credencial de transcrição. Salve a credencial novamente.',
      409,
    );
  }
}

export class TranscriptionDisabledError extends AppException {
  constructor() {
    super(
      'AI_TRANSCRIPTION_DISABLED',
      'A transcrição de áudio está desativada para esta organização.',
      409,
    );
  }
}

export class TranscriptionNotConfiguredError extends AppException {
  constructor() {
    super(
      'AI_TRANSCRIPTION_NOT_CONFIGURED',
      'A transcrição de áudio ainda não está configurada para esta organização.',
      409,
    );
  }
}

export class TranscriptionMessageNotFoundError extends AppException {
  constructor() {
    super('AI_TRANSCRIPTION_MESSAGE_NOT_FOUND', 'Mensagem não encontrada.', 404);
  }
}

export class TranscriptionNotAvailableError extends AppException {
  constructor() {
    super(
      'AI_TRANSCRIPTION_NOT_AVAILABLE',
      'Esta mensagem não possui transcrição de áudio.',
      404,
    );
  }
}

export class TranscriptionRetryNotAllowedError extends AppException {
  constructor() {
    super(
      'AI_TRANSCRIPTION_RETRY_NOT_ALLOWED',
      'Esta transcrição não pode ser reprocessada.',
      409,
    );
  }
}

export class TranscriptionRetryUnavailableError extends AppException {
  constructor() {
    super(
      'AI_TRANSCRIPTION_RETRY_UNAVAILABLE',
      'Ative a transcrição de áudio e configure a credencial OpenAI antes de tentar novamente.',
      409,
    );
  }
}
