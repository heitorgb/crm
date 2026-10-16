import { AppException } from '../../common/errors/app.exception.js';

export class BillingChargeNotFoundError extends AppException {
  constructor() {
    super('BILLING_CHARGE_NOT_FOUND', 'Cobrança não encontrada', 404);
  }
}

export class BillingChargeNotEditableError extends AppException {
  constructor() {
    super(
      'BILLING_CHARGE_NOT_EDITABLE',
      'Apenas cobranças pendentes podem ser editadas',
      409,
    );
  }
}

export class BillingChargeNotPayableError extends AppException {
  constructor() {
    super('BILLING_CHARGE_NOT_PAYABLE', 'Apenas cobranças pendentes podem ser baixadas', 409);
  }
}

export class BillingChargeNotCancelableError extends AppException {
  constructor() {
    super('BILLING_CHARGE_NOT_CANCELABLE', 'Apenas cobranças pendentes podem ser canceladas', 409);
  }
}

export class BillingCustomerNotFoundError extends AppException {
  constructor() {
    super('BILLING_CUSTOMER_NOT_FOUND', 'Cliente não encontrado', 404);
  }
}

export class BillingContactNotFoundError extends AppException {
  constructor() {
    super('BILLING_CONTACT_NOT_FOUND', 'Contato não encontrado para este cliente', 404);
  }
}

export class BillingRecurrenceNotFoundError extends AppException {
  constructor() {
    super('BILLING_RECURRENCE_NOT_FOUND', 'Recorrência não encontrada', 404);
  }
}

export class BillingInstanceNotFoundError extends AppException {
  constructor() {
    super('BILLING_INSTANCE_NOT_FOUND', 'Instância de WhatsApp não encontrada', 404);
  }
}

export class BillingInvalidDateError extends AppException {
  constructor(message = 'Data inválida. Use o formato YYYY-MM-DD.') {
    super('BILLING_INVALID_DATE', message, 400);
  }
}
