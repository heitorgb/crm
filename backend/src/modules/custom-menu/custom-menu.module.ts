import { Module } from '@nestjs/common';
import { CustomMenuController } from './custom-menu.controller.js';
import { CustomMenuService } from './custom-menu.service.js';

@Module({
  controllers: [CustomMenuController],
  providers: [CustomMenuService],
  exports: [CustomMenuService],
})
export class CustomMenuModule {}
