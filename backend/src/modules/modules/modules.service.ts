import { Injectable, Logger } from '@nestjs/common';
import type { Module } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  ModuleNotFoundError,
  ModuleNotControllableError,
  ModuleTenantNotFoundError,
} from './modules.errors.js';

export interface ModuleCatalogView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  sortOrder: number;
  controllable: boolean;
}

export interface TenantModuleView extends ModuleCatalogView {
  enabled: boolean;
}

/**
 * Central availability registry. A module is enabled for a tenant unless there
 * is an explicit `tenant_modules` row marking it disabled, so organizations
 * without any configuration keep the previous behavior. The catalog feeds the
 * platform admin UI and the guard/jobs consume `isEnabled`.
 */
@Injectable()
export class ModulesService {
  private readonly logger = new Logger(ModulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listCatalog(): Promise<ModuleCatalogView[]> {
    const modules = await this.prisma.module.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return modules.map(toCatalogView);
  }

  async listEnabledKeys(tenantId: string): Promise<string[]> {
    const states = await this.listForTenant(tenantId);
    return states.filter((state) => state.enabled).map((state) => state.key);
  }

  async listForTenant(tenantId: string): Promise<TenantModuleView[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new ModuleTenantNotFoundError();
    }

    const modules = await this.prisma.module.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { tenants: { where: { tenantId }, select: { enabled: true } } },
    });

    return modules.map((module) => ({
      ...toCatalogView(module),
      enabled: isEffectivelyEnabled(module.controllable, module.tenants[0]?.enabled),
    }));
  }

  async isEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
    const module = await this.prisma.module.findUnique({
      where: { key: moduleKey },
      select: { id: true, controllable: true },
    });

    if (!module) {
      this.logger.warn(`Module "${moduleKey}" is not in the catalog; treating it as enabled`);
      return true;
    }
    if (!module.controllable) {
      return true;
    }

    const row = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
      select: { enabled: true },
    });

    return row?.enabled ?? true;
  }

  async setModuleEnabledForTenant(params: {
    tenantId: string;
    moduleKey: string;
    enabled: boolean;
    actorUserId: string | null;
  }): Promise<TenantModuleView> {
    const { tenantId, moduleKey, enabled, actorUserId } = params;

    const module = await this.prisma.module.findUnique({
      where: { key: moduleKey },
      select: { id: true, controllable: true },
    });
    if (!module) {
      throw new ModuleNotFoundError();
    }
    if (!module.controllable) {
      throw new ModuleNotControllableError();
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new ModuleTenantNotFoundError();
    }

    const previous = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
      select: { enabled: true },
    });
    const previousEnabled = previous?.enabled ?? true;

    await this.prisma.$transaction(async (tx) => {
      await tx.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
        update: { enabled },
        create: { tenantId, moduleId: module.id, enabled },
      });

      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          tenantId,
          action: enabled ? 'MODULE_ENABLED' : 'MODULE_DISABLED',
          entity: 'module',
          entityId: moduleKey,
          metadata: { previousEnabled, enabled } satisfies Prisma.InputJsonObject,
        },
      });
    });

    const catalog = await this.prisma.module.findUniqueOrThrow({ where: { key: moduleKey } });
    const updated = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
      select: { enabled: true },
    });

    return { ...toCatalogView(catalog), enabled: updated?.enabled ?? enabled };
  }
}

function toCatalogView(module: Module): ModuleCatalogView {
  return {
    id: module.id,
    key: module.key,
    name: module.name,
    description: module.description,
    category: module.category,
    icon: module.icon,
    sortOrder: module.sortOrder,
    controllable: module.controllable,
  };
}

function isEffectivelyEnabled(
  controllable: boolean,
  rowEnabled: boolean | undefined,
): boolean {
  if (!controllable) {
    return true;
  }
  return rowEnabled ?? true;
}
