import { AppException } from '../../common/errors/app.exception.js';

export class TicketNotFoundError extends AppException {
  constructor() {
    super('TICKET_NOT_FOUND', 'Ticket not found', 404);
  }
}
