import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { RateLimitModule } from './common/http/rate-limit/rate-limit.module.js';
import { buildLoggerOptions } from './common/logging/logger.config.js';
import { TenantContextMiddleware } from './common/tenant-context/tenant-context.middleware.js';
import { TenantContextModule } from './common/tenant-context/tenant-context.module.js';
import { TenantContextService } from './common/tenant-context/tenant-context.service.js';
import type { Env } from './config/env.validation.js';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { CryptoModule } from './infrastructure/crypto/crypto.module.js';
import { MediaModule } from './infrastructure/media/media.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { RealtimeModule } from './infrastructure/realtime/realtime.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ModulesModule } from './modules/modules/modules.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { MembershipsModule } from './modules/memberships/memberships.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { TagsModule } from './modules/tags/tags.module.js';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module.js';
import { ConversationsModule } from './modules/conversations/conversations.module.js';
import { BulkMediaModule } from './modules/bulk-media/bulk-media.module.js';
import { ScheduledMessagesModule } from './modules/scheduled-messages/scheduled-messages.module.js';
import { LinkPreviewsModule } from './modules/link-previews/link-previews.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { IntegrationsWebhooksModule } from './modules/integrations/webhooks/integrations-webhooks.module.js';
import { LeadsModule } from './modules/leads/leads.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, TenantContextService],
      useFactory: (config: ConfigService<Env, true>, tenantContext: TenantContextService) => ({
        pinoHttp: buildLoggerOptions(
          {
            NODE_ENV: config.getOrThrow('NODE_ENV'),
            LOG_LEVEL: config.getOrThrow('LOG_LEVEL'),
          },
          tenantContext,
        ),
      }),
    }),
    TenantContextModule,
    RateLimitModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    StorageModule,
    MediaModule,
    QueueModule,
    RealtimeModule,
    HealthModule,
    MembershipsModule,
    AuthModule,
    ModulesModule,
    AdminModule,
    TenantsModule,
    CustomersModule,
    ContactsModule,
    TagsModule,
    WhatsAppModule,
    ConversationsModule,
    BulkMediaModule,
    ScheduledMessagesModule,
    LinkPreviewsModule,
    WebhooksModule,
    BillingModule,
    IntegrationsWebhooksModule,
    LeadsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantContextMiddleware)
      .forRoutes({ path: '*splat', method: RequestMethod.ALL });
  }
}
