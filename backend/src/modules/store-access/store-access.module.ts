import { Global, Module } from '@nestjs/common';
import { ConversationAccessGuard } from './conversation-access.guard.js';
import { StoreAccessService } from './store-access.service.js';

@Global()
@Module({
  providers: [StoreAccessService, ConversationAccessGuard],
  exports: [StoreAccessService, ConversationAccessGuard],
})
export class StoreAccessModule {}
