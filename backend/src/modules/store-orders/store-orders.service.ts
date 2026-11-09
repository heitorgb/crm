import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StoreOrderStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { ALLOWED_AVATAR_FORMATS, MediaProcessingService } from '../../infrastructure/media/media-processing.service.js';
import { STORAGE, type StorageService } from '../../infrastructure/storage/storage.types.js';
import type { Env } from '../../config/env.validation.js';
import { ModuleDisabledError } from '../modules/modules.errors.js';
import { ModulesService } from '../modules/modules.service.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { extractWebhookSecret, generateWebhookSecret, webhookSecretMatches } from '../integrations/webhooks/webhook-secret.js';
import type { ApprovedOrderDto, CreateManualOrderDto, CreateStoreDto, UpdateStoreDto } from './store-orders.dto.js';

const STATUS_TRANSITIONS: Record<StoreOrderStatus, StoreOrderStatus[]> = {
  PENDENTE_SEPARACAO: ['SEPARANDO', 'OBSERVACAO'],
  SEPARANDO: ['SEPARADO', 'OBSERVACAO'],
  SEPARADO: ['EM_ROTA', 'OBSERVACAO'],
  EM_ROTA: ['ENTREGUE', 'OBSERVACAO'],
  OBSERVACAO: ['PENDENTE_SEPARACAO', 'SEPARANDO', 'SEPARADO', 'EM_ROTA'],
  ENTREGUE: [],
};

@Injectable()
export class StoreOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly realtime: RealtimeService,
    private readonly modules: ModulesService,
    private readonly media: MediaProcessingService,
    private readonly config: ConfigService<Env, true>,
    @Inject(STORAGE) private readonly storage: StorageService,
  ) {}

  async createStore(dto: CreateStoreDto) {
    const { tenantId } = this.tenantContext.requireContext();
    const name = dto.name.trim();
    const externalCode = dto.externalCode.trim();
    if (!name || !externalCode) {
      throw new AppException('STORE_FIELDS_REQUIRED', 'Informe o nome e o código da loja.', 400);
    }
    const generated = generateWebhookSecret();
    const store = await this.prisma.store.create({
      data: {
        tenantId,
        name,
        externalCode,
        deliveryConfirmationMode: dto.deliveryConfirmationMode ?? 'AUTOMATIC',
        integrationSecretHash: generated.hash,
      },
      select: { id: true, name: true, externalCode: true, deliveryConfirmationMode: true, active: true, logoUpdatedAt: true },
    });
    return { ...store, secret: generated.secret };
  }

  manageStores() {
    const { tenantId } = this.tenantContext.requireContext();
    return this.prisma.store.findMany({
      where: { tenantId },
      select: { id: true, name: true, externalCode: true, deliveryConfirmationMode: true, active: true, createdAt: true, logoUpdatedAt: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateStore(storeId: string, dto: UpdateStoreDto) {
    const { tenantId } = this.tenantContext.requireContext();
    const store = await this.prisma.store.findFirst({ where: { id: storeId, tenantId } });
    if (!store) throw new AppException('STORE_NOT_FOUND', 'Loja não encontrada.', 404);
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) throw new AppException('STORE_NAME_REQUIRED', 'Informe o nome da loja.', 400);
    return this.prisma.store.update({
      where: { id: storeId },
      data: { ...(name ? { name } : {}),
        ...(dto.deliveryConfirmationMode ? { deliveryConfirmationMode: dto.deliveryConfirmationMode } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}) },
      select: { id: true, name: true, externalCode: true, deliveryConfirmationMode: true, active: true, createdAt: true, logoUpdatedAt: true },
    });
  }

  async rotateStoreSecret(storeId: string) {
    const { tenantId } = this.tenantContext.requireContext();
    const store = await this.prisma.store.findFirst({ where: { id: storeId, tenantId } });
    if (!store) throw new AppException('STORE_NOT_FOUND', 'Loja não encontrada.', 404);
    const generated = generateWebhookSecret();
    await this.prisma.store.update({ where: { id: storeId }, data: { integrationSecretHash: generated.hash } });
    return { id: storeId, secret: generated.secret };
  }

  async updateStoreLogo(storeId: string, input: Buffer) {
    const { tenantId } = this.tenantContext.requireContext();
    if (input.length > this.config.get('AVATAR_MAX_BYTES')) {
      throw new AppException('STORE_LOGO_TOO_LARGE', 'A logo deve ter no máximo 5 MB.', 413);
    }
    const store = await this.prisma.store.findFirst({ where: { id: storeId, tenantId }, select: { logoStorageKey: true } });
    if (!store) throw new AppException('STORE_NOT_FOUND', 'Loja não encontrada.', 404);
    const format = await this.media.detectImageFormat(input);
    if (!format || !ALLOWED_AVATAR_FORMATS.includes(format as typeof ALLOWED_AVATAR_FORMATS[number])) {
      throw new AppException('STORE_LOGO_INVALID', 'Envie uma imagem JPEG, PNG ou WebP válida.', 422);
    }
    const optimized = await this.media.makeThumbnail(input);
    const key = `tenant/${tenantId}/stores/${storeId}/logo/${randomUUID()}.${optimized.extension}`;
    await this.storage.put(key, optimized.buffer);
    let updated;
    try {
      updated = await this.prisma.store.update({
        where: { id: storeId },
        data: { logoStorageKey: key, logoUpdatedAt: new Date() },
        select: { id: true, logoUpdatedAt: true },
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    if (store.logoStorageKey) await this.storage.delete(store.logoStorageKey).catch(() => undefined);
    return updated;
  }

  async removeStoreLogo(storeId: string) {
    const { tenantId } = this.tenantContext.requireContext();
    const store = await this.prisma.store.findFirst({ where: { id: storeId, tenantId }, select: { logoStorageKey: true } });
    if (!store) throw new AppException('STORE_NOT_FOUND', 'Loja não encontrada.', 404);
    await this.prisma.store.update({ where: { id: storeId }, data: { logoStorageKey: null, logoUpdatedAt: null } });
    if (store.logoStorageKey) await this.storage.delete(store.logoStorageKey).catch(() => undefined);
  }

  async readStoreLogo(storeId: string): Promise<Buffer> {
    const { tenantId } = this.tenantContext.requireContext();
    const store = await this.prisma.store.findFirst({ where: { id: storeId, tenantId }, select: { logoStorageKey: true } });
    if (!store || !store.logoStorageKey) throw new AppException('STORE_LOGO_NOT_FOUND', 'Logo não encontrada.', 404);
    return this.storage.get(store.logoStorageKey);
  }

  listStores() {
    const { tenantId } = this.tenantContext.requireContext();
    return this.prisma.store.findMany({
      where: { tenantId, active: true },
      select: { id: true, name: true, externalCode: true, deliveryConfirmationMode: true, logoUpdatedAt: true },
      orderBy: { name: 'asc' },
    });
  }

  async getDeliveryCards() {
    const { tenantId } = this.tenantContext.requireContext();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId }, select: { deliveryVisibleStatuses: true },
    });
    return { statuses: tenant.deliveryVisibleStatuses };
  }

  async updateDeliveryCards(statuses: StoreOrderStatus[]) {
    const { tenantId } = this.tenantContext.requireContext();
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId }, data: { deliveryVisibleStatuses: statuses },
      select: { deliveryVisibleStatuses: true },
    });
    this.realtime.emitToTenant(tenantId, 'store-order.cards-updated', {});
    return { statuses: tenant.deliveryVisibleStatuses };
  }

  async listOrders(storeId?: string, search?: string) {
    const { tenantId } = this.tenantContext.requireContext();
    if (storeId && !/^[0-9a-f-]{36}$/i.test(storeId)) {
      throw new AppException('STORE_ID_INVALID', 'Loja inválida.', 400);
    }
    const term = search?.trim().slice(0, 120);
    const where: Prisma.StoreOrderWhereInput = {
      tenantId,
      ...(storeId ? { storeId } : {}),
      ...(term ? { OR: [
        { externalOrderId: { contains: term, mode: 'insensitive' } },
        { customerName: { contains: term, mode: 'insensitive' } },
        { contact: { name: { contains: term, mode: 'insensitive' } } },
      ] } : {}),
    };
    const [data, grouped] = await this.prisma.$transaction([
      this.prisma.storeOrder.findMany({
        where,
        omit: { items: true },
        include: { store: { select: { id: true, name: true, logoUpdatedAt: true } }, contact: { select: { id: true, name: true, address: true } } },
        orderBy: { approvedAt: 'desc' },
        take: 200,
      }),
      this.prisma.storeOrder.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    return { data, counts: Object.fromEntries(grouped.map((item) => [item.status, item._count._all])) };
  }

  async getOrder(id: string) {
    const { tenantId } = this.tenantContext.requireContext();
    const order = await this.prisma.storeOrder.findFirst({
      where: { id, tenantId },
      include: { store: { select: { id: true, name: true, logoUpdatedAt: true } }, contact: { select: { id: true, name: true, address: true } } },
    });
    if (!order) throw new AppException('ORDER_NOT_FOUND', 'Pedido não encontrado.', 404);
    return order;
  }

  async createManual(dto: CreateManualOrderDto) {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const text = dto.orderText.trim();
    if (!text) throw new AppException('ORDER_TEXT_REQUIRED', 'Informe o texto do pedido.', 400);
    const [store, contact] = await Promise.all([
      this.prisma.store.findFirst({ where: { id: dto.storeId, tenantId, active: true } }),
      this.prisma.contact.findFirst({ where: { id: dto.contactId, tenantId } }),
    ]);
    if (!store || !contact) throw new AppException('ORDER_PARTY_NOT_FOUND', 'Loja ou contato não encontrado.', 404);
    const externalOrderId = `manual:${dto.requestId ?? randomUUID()}`;
    let order;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const order = await tx.storeOrder.create({
          data: {
            tenantId, storeId: store.id, contactId: contact.id,
            externalOrderId,
            customerName: contact.name, orderText: text, approvedAt: new Date(),
          },
        });
        await tx.storeOrderStatusChange.create({
          data: { tenantId, orderId: order.id, status: 'PENDENTE_SEPARACAO',
            actorMembershipId: membershipId, origin: 'CRM_MANUAL' },
        });
        return order;
      });
    } catch (error) {
      if (!(dto.requestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      const existing = await this.prisma.storeOrder.findUnique({
        where: { storeId_externalOrderId: { storeId: store.id, externalOrderId } },
      });
      if (!existing || existing.tenantId !== tenantId || existing.contactId !== contact.id || existing.orderText !== text) throw error;
      return existing;
    }
    this.realtime.emitToTenant(tenantId, 'store-order.updated', { orderId: order.id });
    return order;
  }

  async updateStatus(id: string, status: StoreOrderStatus) {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.storeOrder.findFirst({ where: { id, tenantId }, include: { store: true } });
      if (!order) throw new AppException('ORDER_NOT_FOUND', 'Pedido não encontrado.', 404);
      if (!STATUS_TRANSITIONS[order.status].includes(status)) {
        throw new AppException('ORDER_STATUS_INVALID', 'Mudança de status não permitida.', 409);
      }
      const now = new Date();
      const enteringRoute = status === 'EM_ROTA' && order.status !== 'EM_ROTA';
      const delivered = status === 'ENTREGUE';
      const updated = await tx.storeOrder.updateMany({
        where: { id, tenantId, status: order.status },
        data: {
          status,
          ...(enteringRoute ? {
            enteredRouteAt: now,
            deliveryConfirmationMode: order.store.deliveryConfirmationMode,
            deliveryDueAt: order.store.deliveryConfirmationMode === 'AUTOMATIC'
              ? new Date(now.getTime() + 2 * 60 * 60 * 1000) : null,
          } : {}),
          ...(delivered ? { deliveredAt: now, deliveryDueAt: null,
            deliveryConfirmationSource: 'MANUAL' as const } : {}),
          ...(status === 'OBSERVACAO' ? { deliveryDueAt: null } : {}),
        },
      });
      if (updated.count !== 1) throw new AppException('ORDER_STATUS_CONFLICT', 'O pedido foi alterado por outro usuário.', 409);
      await tx.storeOrderStatusChange.create({
        data: { tenantId, orderId: id, previousStatus: order.status, status,
          actorMembershipId: membershipId, origin: 'CRM_USER' },
      });
      return tx.storeOrder.findUniqueOrThrow({ where: { id } });
    });
    this.realtime.emitToTenant(tenantId, 'store-order.updated', { orderId: id });
    return order;
  }

  async receiveApproved(storeId: string, authorization: string | undefined, dto: ApprovedOrderDto) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, tenantId: true, active: true, integrationSecretHash: true },
    });
    const secret = extractWebhookSecret(authorization, undefined);
    if (!store || !store.active || !store.integrationSecretHash || !secret ||
      !webhookSecretMatches(secret, store.integrationSecretHash)) {
      throw new AppException('STORE_UNAUTHORIZED', 'Credencial da loja inválida.', 401);
    }
    if (!(await this.modules.isEnabled(store.tenantId, MODULE_KEYS.DELIVERIES))) {
      throw new ModuleDisabledError(MODULE_KEYS.DELIVERIES);
    }

    const externalOrderId = dto.externalOrderId.trim();
    if (!externalOrderId) {
      throw new AppException('ORDER_ID_REQUIRED', 'O ID do pedido é obrigatório.', 400);
    }
    const approvedAt = new Date(dto.approvedAt);
    if (Number.isNaN(approvedAt.getTime())) {
      throw new AppException('APPROVED_AT_INVALID', 'Data de aprovação inválida.', 400);
    }

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.storeOrder.create({
          data: {
            tenantId: store.tenantId,
            storeId: store.id,
            externalOrderId,
            approvedAt,
            customerName: dto.customerName?.trim() || null,
            orderText: dto.orderText?.trim() || null,
            ...(dto.items ? { items: dto.items.map((item) => ({
              productCode: item.productCode.trim(), description: item.description.trim(),
              quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal,
            })) } : {}),
            ...(dto.totalAmount ? { totalAmount: dto.totalAmount } : {}),
          },
        });
        await tx.storeOrderStatusChange.create({
          data: {
            tenantId: store.tenantId,
            orderId: created.id,
            status: 'PENDENTE_SEPARACAO',
            origin: 'STORE_APPROVAL',
          },
        });
        return created;
      });
      this.realtime.emitToTenant(store.tenantId, 'store-order.updated', { orderId: order.id });
      return { id: order.id, status: order.status, created: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
      const existing = await this.prisma.storeOrder.findUnique({
        where: { storeId_externalOrderId: { storeId: store.id, externalOrderId } },
        select: { id: true, tenantId: true, status: true },
      });
      if (!existing || existing.tenantId !== store.tenantId) throw error;
      if (dto.items) {
        const enriched = await this.prisma.storeOrder.updateMany({
          where: { id: existing.id, tenantId: store.tenantId, items: { equals: Prisma.DbNull } },
          data: {
            items: dto.items.map((item) => ({
              productCode: item.productCode.trim(), description: item.description.trim(),
              quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal,
            })),
            ...(dto.totalAmount ? { totalAmount: dto.totalAmount } : {}),
          },
        });
        if (enriched.count === 1) this.realtime.emitToTenant(store.tenantId, 'store-order.updated', { orderId: existing.id });
      }
      return { id: existing.id, status: existing.status, created: false };
    }
  }
}
