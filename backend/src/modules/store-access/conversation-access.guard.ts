import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { StoreAccessService } from './store-access.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rejects routes whose `:id` or `:conversationId` param names a conversation outside the member's stores. */
@Injectable()
export class ConversationAccessGuard implements CanActivate {
  constructor(private readonly access: StoreAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ params?: Record<string, string | undefined> }>();
    const conversationId = request.params?.conversationId ?? request.params?.id;
    if (conversationId && UUID_PATTERN.test(conversationId)) {
      await this.access.assertConversations([conversationId]);
    }
    return true;
  }
}
