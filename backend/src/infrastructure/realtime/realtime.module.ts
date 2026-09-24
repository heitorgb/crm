import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MembershipsModule } from '../../modules/memberships/memberships.module.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeService } from './realtime.service.js';

@Global()
@Module({
  imports: [JwtModule.register({}), MembershipsModule],
  providers: [RealtimeService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
