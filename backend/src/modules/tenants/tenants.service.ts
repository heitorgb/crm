import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { UpdateTenantDto } from './dto/tenant.dto.js';
import { TenantNotFoundError } from './tenants.errors.js';

export interface TenantView {
  id: string;
  name: string;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getCurrent(): Promise<TenantView> {
    const { tenantId } = this.tenantContext.requireContext();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });

    if (!tenant) {
      throw new TenantNotFoundError();
    }

    return tenant;
  }

  async rename(dto: UpdateTenantDto): Promise<TenantView> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.tenant.updateMany({
      where: { id: tenantId },
      data: { name: dto.name.trim() },
    });

    if (result.count === 0) {
      throw new TenantNotFoundError();
    }

    return this.getCurrent();
  }
}
