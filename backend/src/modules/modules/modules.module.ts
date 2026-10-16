import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ModuleEnabledGuard } from './module-enabled.guard.js';
import { ModulesController } from './modules.controller.js';
import { ModulesService } from './modules.service.js';

@Module({
  controllers: [ModulesController],
  providers: [
    ModulesService,
    ModuleEnabledGuard,
    { provide: APP_GUARD, useClass: ModuleEnabledGuard },
  ],
  exports: [ModulesService],
})
export class ModulesModule {}
