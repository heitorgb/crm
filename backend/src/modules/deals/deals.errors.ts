import { AppException } from '../../common/errors/app.exception.js';

export class DealNotFoundError extends AppException {
  constructor() {
    super('DEAL_NOT_FOUND', 'Deal not found', 404);
  }
}

export class DealPipelineNotFoundError extends AppException {
  constructor() {
    super('DEAL_PIPELINE_NOT_FOUND', 'Pipeline not found', 404);
  }
}

export class DealStageNotFoundError extends AppException {
  constructor() {
    super('DEAL_STAGE_NOT_FOUND', 'Pipeline stage not found', 404);
  }
}

export class DealStagePipelineMismatchError extends AppException {
  constructor() {
    super('DEAL_STAGE_PIPELINE_MISMATCH', 'Stage does not belong to the deal pipeline', 400);
  }
}

export class DealPipelineEmptyError extends AppException {
  constructor() {
    super('DEAL_PIPELINE_EMPTY', 'Pipeline has no stages configured', 400);
  }
}

export class DealRelationNotFoundError extends AppException {
  constructor() {
    super('DEAL_RELATION_NOT_FOUND', 'Related record not found for this tenant', 404);
  }
}
