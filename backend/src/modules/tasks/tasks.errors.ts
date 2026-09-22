import { AppException } from '../../common/errors/app.exception.js';

export class TaskNotFoundError extends AppException {
  constructor() {
    super('TASK_NOT_FOUND', 'Task not found', 404);
  }
}

export class TaskRelationNotFoundError extends AppException {
  constructor() {
    super('TASK_RELATION_NOT_FOUND', 'Related record not found for this tenant', 404);
  }
}
