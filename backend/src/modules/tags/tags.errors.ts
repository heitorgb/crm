import { AppException } from '../../common/errors/app.exception.js';

export class TagNotFoundError extends AppException {
  constructor() {
    super('TAG_NOT_FOUND', 'Tag not found', 404);
  }
}

export class TagNameConflictError extends AppException {
  constructor() {
    super('TAG_NAME_CONFLICT', 'A tag with this name already exists', 409);
  }
}
