import { AppException } from '../../common/errors/app.exception.js';

export class LeadNotFoundError extends AppException {
  constructor() {
    super('LEAD_NOT_FOUND', 'Lead não encontrado', 404);
  }
}

export class LeadPipelineNotFoundError extends AppException {
  constructor() {
    super('LEAD_PIPELINE_NOT_FOUND', 'Pipeline não encontrado', 404);
  }
}

export class LeadStageNotFoundError extends AppException {
  constructor() {
    super('LEAD_STAGE_NOT_FOUND', 'Etapa não encontrada', 404);
  }
}

export class LeadStageInUseError extends AppException {
  constructor() {
    super('LEAD_STAGE_IN_USE', 'A etapa possui leads e não pode ser excluída', 409);
  }
}
