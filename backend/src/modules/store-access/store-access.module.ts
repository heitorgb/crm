import { Global, Module } from '@nestjs/common';
import { ModulesModule } from '../modules/modules.module.js';
import { ConversationAccessGuard } from './conversation-access.guard.js';
import { StoreAccessService } from './store-access.service.js';

@Global()
@Module({
  imports: [ModulesModule],
  providers: [StoreAccessService, ConversationAccessGuard],
  exports: [StoreAccessService, ConversationAccessGuard],
})
export class StoreAccessModule {}
