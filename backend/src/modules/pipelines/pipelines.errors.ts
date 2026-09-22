import { AppException } from '../../common/errors/app.exception.js';

export class PipelineNotFoundError extends AppException {
  constructor() {
    super('PIPELINE_NOT_FOUND', 'Pipeline not found', 404);
  }
}

export class PipelineStageNotFoundError extends AppException {
  constructor() {
    super('PIPELINE_STAGE_NOT_FOUND', 'Pipeline stage not found', 404);
  }
}

export class PipelineNameConflictError extends AppException {
  constructor() {
    super('PIPELINE_NAME_CONFLICT', 'A pipeline with this name already exists', 409);
  }
}

export class PipelineStagePositionConflictError extends AppException {
  constructor() {
    super('PIPELINE_STAGE_POSITION_CONFLICT', 'Another stage already uses this position', 409);
  }
}

export class PipelineInUseError extends AppException {
  constructor() {
    super('PIPELINE_IN_USE', 'Pipeline or stage is referenced by existing deals', 409);
  }
}
