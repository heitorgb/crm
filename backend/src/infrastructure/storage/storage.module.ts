import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { LocalDiskStorage } from './local-disk.storage.js';
import { STORAGE } from './storage.types.js';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const provider = config.get('STORAGE_PROVIDER');
        if (provider === 'local') {
          return new LocalDiskStorage(config);
        }
        throw new Error(`Storage provider "${provider}" is not implemented yet`);
      },
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
