import { Global, Module } from '@nestjs/common';
import { FcmClient } from './fcm.client.js';

@Global()
@Module({
  providers: [FcmClient],
  exports: [FcmClient],
})
export class PushModule {}
