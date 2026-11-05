import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RateLimit } from '../../common/http/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../../common/http/rate-limit/rate-limit.guard.js';
import { Public, Roles } from '../auth/decorators/auth.decorators.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { RequireModule } from '../modules/require-module.decorator.js';
import { ApprovedOrderDto, CreateManualOrderDto, CreateStoreDto, UpdateOrderStatusDto, UpdateStoreDto } from './store-orders.dto.js';
import { StoreOrdersService } from './store-orders.service.js';

@Controller('store-orders')
export class StoreOrdersController {
  constructor(private readonly orders: StoreOrdersService) {}

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Post('stores')
  createStore(@Body() dto: CreateStoreDto) {
    return this.orders.createStore(dto);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Get('stores/manage')
  manageStores() {
    return this.orders.manageStores();
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Patch('stores/:storeId')
  updateStore(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() dto: UpdateStoreDto) {
    return this.orders.updateStore(storeId, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Post('stores/:storeId/rotate-secret')
  @HttpCode(200)
  rotateStoreSecret(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.orders.rotateStoreSecret(storeId);
  }

  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Get('stores')
  listStores() {
    return this.orders.listStores();
  }

  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Get()
  listOrders(
    @Query('storeId') storeId?: string,
    @Query('search') search?: string,
  ) {
    return this.orders.listOrders(storeId, search);
  }

  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Post('manual')
  createManual(@Body() dto: CreateManualOrderDto) {
    return this.orders.createManual(dto);
  }

  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateStatus(id, dto.status);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'store-order-approved', limit: 120, windowMs: 60_000 })
  @Post('stores/:storeId/approved')
  @HttpCode(200)
  receiveApproved(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: ApprovedOrderDto,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.orders.receiveApproved(storeId, authorization, dto);
  }
}
