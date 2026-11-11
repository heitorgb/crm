import { Injectable } from '@nestjs/common';
import { PushPlatform } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { PushDevicePlatform, RegisterPushDeviceDto } from './dto/push-device.dto.js';

const PLATFORMS: Record<PushDevicePlatform, PushPlatform> = {
  android: PushPlatform.ANDROID,
};

@Injectable()
export class PushDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * A token identifies one physical device, so registering it again (another
   * account or organization signed in on the same phone) moves it to the
   * current membership instead of notifying the previous one.
   */
  async register(dto: RegisterPushDeviceDto): Promise<void> {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    const platform = PLATFORMS[dto.platform];

    await this.prisma.pushDevice.upsert({
      where: { token: dto.token },
      create: { tenantId, tenantUserId: membershipId, token: dto.token, platform },
      update: { tenantId, tenantUserId: membershipId, platform },
    });
  }

  async unregister(token: string): Promise<void> {
    const { tenantId, membershipId } = this.tenantContext.requireContext();
    await this.prisma.pushDevice.deleteMany({
      where: { token, tenantId, tenantUserId: membershipId },
    });
  }
}
