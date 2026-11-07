import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from '../../common/errors/app.exception.js';
import { RateLimit } from '../../common/http/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../../common/http/rate-limit/rate-limit.guard.js';
import { Public, Roles } from '../auth/decorators/auth.decorators.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { RequireModule } from '../modules/require-module.decorator.js';
import { ApprovedOrderDto, CreateManualOrderDto, CreateStoreDto, UpdateDeliveryCardsDto, UpdateOrderStatusDto, UpdateStoreDto } from './store-orders.dto.js';
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

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Post('stores/:storeId/logo')
  @HttpCode(200)
  async updateStoreLogo(@Param('storeId', ParseUUIDPipe) storeId: string, @Req() request: FastifyRequest) {
    if (!request.isMultipart()) throw new AppException('STORE_LOGO_REQUIRED', 'Envie a logo como imagem.', 400);
    const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
    if (!file) throw new AppException('STORE_LOGO_REQUIRED', 'Selecione uma imagem.', 400);
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      if (typeof error === 'object' && error !== null &&
        ('code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE')) {
        throw new AppException('STORE_LOGO_TOO_LARGE', 'A logo deve ter no máximo 5 MB.', 413);
      }
      throw error;
    }
    return this.orders.updateStoreLogo(storeId, buffer);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Delete('stores/:storeId/logo')
  @HttpCode(204)
  removeStoreLogo(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.orders.removeStoreLogo(storeId);
  }

  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Get('stores/:storeId/logo')
  async readStoreLogo(@Param('storeId', ParseUUIDPipe) storeId: string, @Res() reply: FastifyReply): Promise<void> {
    const buffer = await this.orders.readStoreLogo(storeId);
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=300');
    reply.send(buffer);
  }

  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Get('stores')
  listStores() {
    return this.orders.listStores();
  }

  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Get('cards')
  getDeliveryCards() {
    return this.orders.getDeliveryCards();
  }

  @Roles('OWNER', 'ADMIN')
  @RequireModule(MODULE_KEYS.DELIVERIES)
  @Patch('cards')
  updateDeliveryCards(@Body() dto: UpdateDeliveryCardsDto) {
    return this.orders.updateDeliveryCards(dto.statuses);
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
  @Get(':id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getOrder(id);
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
