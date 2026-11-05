import { Injectable } from '@nestjs/common';
import { Prisma, StoreOrderStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
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
      select: { id: true, name: true, externalCode: true, deliveryConfirmationMode: true, active: true },
    });
    return { ...store, secret: generated.secret };
  }

  manageStores() {
    const { tenantId } = this.tenantContext.requireContext();
    return this.prisma.store.findMany({
      where: { tenantId },
      select: { id: true, name: true, externalCode: true, deliveryConfirmationMode: true, active: true, createdAt: true },
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
      select: { id: true, name: true, externalCode: true, deliveryConfirmationMode: true, active: true, createdAt: true },
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

  listStores() {
    const { tenantId } = this.tenantContext.requireContext();
    return this.prisma.store.findMany({
      where: { tenantId, active: true },
      select: { id: true, name: true, externalCode: true, deliveryConfirmationMode: true },
      orderBy: { name: 'asc' },
    });
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
        include: { store: { select: { id: true, name: true } }, contact: { select: { id: true, name: true, address: true } } },
        orderBy: { approvedAt: 'desc' },
        take: 200,
      }),
      this.prisma.storeOrder.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    return { data, counts: Object.fromEntries(grouped.map((item) => [item.status, item._count._all])) };
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
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.storeOrder.create({
        data: {
          tenantId, storeId: store.id, contactId: contact.id,
          externalOrderId: `manual:${randomUUID()}`,
          customerName: contact.name, orderText: text, approvedAt: new Date(),
        },
      });
      await tx.storeOrderStatusChange.create({
        data: { tenantId, orderId: order.id, status: 'PENDENTE_SEPARACAO',
          actorMembershipId: membershipId, origin: 'CRM_MANUAL' },
      });
      return order;
    });
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
        select: { id: true, status: true },
      });
      if (!existing) throw error;
      return { id: existing.id, status: existing.status, created: false };
    }
  }
}
