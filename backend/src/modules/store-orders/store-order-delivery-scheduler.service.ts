import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StoreOrderStatus } from '@prisma/client';
import type { Env } from '../../config/env.validation.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { FcmClient, type PushMessage } from '../../infrastructure/push/fcm.client.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { JOB_NAMES, JOB_QUEUE, type JobQueue } from '../../infrastructure/queue/job-queue.types.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { ModulesService } from '../modules/modules.service.js';
import { hasFullStoreAccess } from '../store-access/store-access.service.js';

const SCAN_INTERVAL_MS = 60_000;
const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const UNSEPARATED_STATUSES: StoreOrderStatus[] = ['PENDENTE_SEPARACAO', 'SEPARANDO'];
const REMINDER_BATCH_SIZE = 100;

interface SeparationReminder {
  storeId: string;
  customer: string;
  store: string;
  waitingMinutes: number;
}

@Injectable()
export class StoreOrderDeliverySchedulerService implements OnModuleInit {
  private readonly logger = new Logger(StoreOrderDeliverySchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly modules: ModulesService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService<Env, true>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly fcm: FcmClient,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.STORE_ORDER_DELIVERY_SCAN, () => this.scan());
    if (this.config.get('NODE_ENV') === 'test') return;
    void this.queue.scheduleRepeatable(JOB_NAMES.STORE_ORDER_DELIVERY_SCAN, SCAN_INTERVAL_MS, {})
      .catch((error: unknown) => {
        this.logger.warn(`Could not schedule delivery scan: ${error instanceof Error ? error.message : 'unknown'}`);
      });
  }

  async scan(now = new Date()): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const { id: tenantId } of tenants) {
      const context: TenantContext = {
        tenantId, userId: SYSTEM_USER_ID, membershipId: SYSTEM_MEMBERSHIP_ID, role: 'SYSTEM',
      };
      await this.tenantContext.run({ tenant: context }, async () => {
        try {
          if (!(await this.modules.isEnabled(tenantId, MODULE_KEYS.DELIVERIES))) return;
          const due = await this.prisma.storeOrder.findMany({
            where: { tenantId, status: 'EM_ROTA', deliveryConfirmationMode: 'AUTOMATIC', deliveryDueAt: { lte: now } },
            select: { id: true },
            orderBy: { deliveryDueAt: 'asc' },
            take: 100,
          });
          for (const { id } of due) await this.confirmDueOrder(tenantId, id, now);
          await this.remindUnseparated(tenantId, now);
        } catch (error) {
          this.logger.warn(`Delivery scan failed for tenant ${tenantId}: ${error instanceof Error ? error.message : 'unknown'}`);
        }
      });
    }
  }

  private async confirmDueOrder(tenantId: string, orderId: string, now: Date): Promise<void> {
    const changed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.storeOrder.updateMany({
        where: {
          id: orderId, tenantId, status: 'EM_ROTA',
          deliveryConfirmationMode: 'AUTOMATIC', deliveryDueAt: { lte: now },
        },
        data: { status: 'ENTREGUE', deliveredAt: now, deliveryDueAt: null, deliveryConfirmationSource: 'AUTOMATIC' },
      });
      if (result.count === 0) return false;
      await tx.storeOrderStatusChange.create({
        data: { tenantId, orderId, previousStatus: 'EM_ROTA', status: 'ENTREGUE', origin: 'AUTO_DELIVERY' },
      });
      return true;
    });
    if (changed) this.realtime.emitToTenant(tenantId, 'store-order.updated', { orderId });
  }

  private async remindUnseparated(tenantId: string, now: Date): Promise<void> {
    const stores = await this.prisma.store.findMany({
      where: { tenantId, active: true, separationReminderMinutes: { not: null } },
      select: { id: true, name: true, separationReminderMinutes: true },
    });
    const reminders: SeparationReminder[] = [];
    for (const store of stores) {
      if (store.separationReminderMinutes === null) continue;
      const overdue = await this.prisma.storeOrder.findMany({
        where: {
          tenantId, storeId: store.id, status: { in: UNSEPARATED_STATUSES }, separationReminderSentAt: null,
          approvedAt: { lte: new Date(now.getTime() - store.separationReminderMinutes * 60_000) },
        },
        select: { id: true, customerName: true, externalOrderId: true, approvedAt: true },
        orderBy: { approvedAt: 'asc' },
        take: REMINDER_BATCH_SIZE,
      });
      for (const order of overdue) {
        const marked = await this.prisma.storeOrder.updateMany({
          where: { id: order.id, tenantId, status: { in: UNSEPARATED_STATUSES }, separationReminderSentAt: null },
          data: { separationReminderSentAt: now },
        });
        if (marked.count === 0) continue;
        this.realtime.emitToTenant(tenantId, 'store-order.updated', { orderId: order.id });
        reminders.push({
          storeId: store.id,
          customer: order.customerName?.trim()
            || (order.externalOrderId.startsWith('manual:') ? 'Pedido manual' : `Pedido #${order.externalOrderId}`),
          store: store.name,
          waitingMinutes: Math.floor((now.getTime() - order.approvedAt.getTime()) / 60_000),
        });
      }
    }
    if (reminders.length > 0) await this.pushReminders(tenantId, reminders);
  }

  private async pushReminders(tenantId: string, reminders: SeparationReminder[]): Promise<void> {
    if (!this.fcm.isConfigured()) return;
    const devices = await this.prisma.pushDevice.findMany({
      where: {
        tenantId,
        tenantUser: {
          tenantId,
          active: true,
          user: { active: true },
          AND: [this.modules.membersWithModule(MODULE_KEYS.DELIVERIES)],
        },
      },
      select: { id: true, token: true, tenantUser: { select: { role: true, storeAccess: { select: { storeId: true } } } } },
    });
    const invalidDeviceIds: string[] = [];
    for (const device of devices) {
      const linkedStoreIds = device.tenantUser.storeAccess.map((link) => link.storeId);
      const visible = hasFullStoreAccess(device.tenantUser.role, linkedStoreIds.length)
        ? reminders
        : reminders.filter((reminder) => linkedStoreIds.includes(reminder.storeId));
      if (visible.length === 0) continue;
      const push = buildSeparationReminderPush(visible);
      if ((await this.fcm.send(device.token, push)) === 'invalid-token') invalidDeviceIds.push(device.id);
    }
    if (invalidDeviceIds.length > 0) {
      await this.prisma.pushDevice.deleteMany({ where: { id: { in: invalidDeviceIds }, tenantId } });
    }
  }
}

export function buildSeparationReminderPush(reminders: SeparationReminder[]): PushMessage {
  const [first] = reminders;
  const single = reminders.length === 1 && first !== undefined;
  return {
    title: single ? 'Pedido aguardando separação' : `${reminders.length} pedidos aguardando separação`,
    body: single
      ? `${first.customer} · ${first.store} — aguardando há ${first.waitingMinutes} min`
      : 'Abra o Acompanhamento para ver os pedidos atrasados.',
    tag: 'store-order-separation-reminder',
    data: { path: '/entregas' },
  };
}
