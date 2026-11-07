import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import type { TenantContext } from '../../common/tenant-context/tenant-context.types.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { JOB_NAMES, JOB_QUEUE, type JobQueue } from '../../infrastructure/queue/job-queue.types.js';
import { MODULE_KEYS } from '../modules/modules.constants.js';
import { ModulesService } from '../modules/modules.service.js';

const SCAN_INTERVAL_MS = 60_000;
const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';

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
}
