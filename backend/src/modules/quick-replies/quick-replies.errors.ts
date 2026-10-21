import { AppException } from '../../common/errors/app.exception.js';

export class QuickReplyNotFoundError extends AppException {
  constructor() {
    super('QUICK_REPLY_NOT_FOUND', 'Quick reply not found', 404);
  }
}

export class QuickReplyTitleConflictError extends AppException {
  constructor() {
    super('QUICK_REPLY_TITLE_CONFLICT', 'A quick reply with this title already exists', 409);
  }
}
