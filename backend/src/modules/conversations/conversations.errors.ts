import { AppException } from '../../common/errors/app.exception.js';

export class ConversationNotFoundError extends AppException {
  constructor() {
    super('CONVERSATION_NOT_FOUND', 'Conversation not found', 404);
  }
}

export class MessageNotFoundError extends AppException {
  constructor() {
    super('MESSAGE_NOT_FOUND', 'Message not found', 404);
  }
}

export class ConversationNotHumanOwnedError extends AppException {
  constructor() {
    super(
      'CONVERSATION_NOT_HUMAN_OWNED',
      'Take over the conversation before sending messages as a human',
      409,
    );
  }
}

export class WhatsAppInstanceInactiveError extends AppException {
  constructor() {
    super('WHATSAPP_INSTANCE_INACTIVE', 'WhatsApp instance is inactive', 409);
  }
}

export class WhatsAppInstanceNotFoundError extends AppException {
  constructor() {
    super('WHATSAPP_INSTANCE_NOT_FOUND', 'WhatsApp instance not found', 404);
  }
}

export class ContactPhoneRequiredError extends AppException {
  constructor() {
    super('CONTACT_PHONE_REQUIRED', 'Contact has no phone to start a conversation', 400);
  }
}
