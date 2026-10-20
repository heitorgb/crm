import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { UpdatePlatformSettingsDto } from './dto/platform-settings.dto.js';

const PLATFORM_SETTINGS_ID = 'global';

export interface PlatformSettingsView {
  linkPreviewsEnabled: boolean;
}

@Injectable()
export class PlatformSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformSettingsView> {
    const settings = await this.prisma.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
      select: { linkPreviewsEnabled: true },
    });

    return {
      linkPreviewsEnabled: settings?.linkPreviewsEnabled ?? false,
    };
  }

  async isLinkPreviewsEnabled(): Promise<boolean> {
    const settings = await this.prisma.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
      select: { linkPreviewsEnabled: true },
    });

    return settings?.linkPreviewsEnabled ?? false;
  }

  async update(
    dto: UpdatePlatformSettingsDto,
    actorUserId: string | null,
  ): Promise<PlatformSettingsView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.platformSettings.findUnique({
        where: { id: PLATFORM_SETTINGS_ID },
        select: { linkPreviewsEnabled: true },
      });

      const settings = await tx.platformSettings.upsert({
        where: { id: PLATFORM_SETTINGS_ID },
        create: {
          id: PLATFORM_SETTINGS_ID,
          linkPreviewsEnabled: dto.linkPreviewsEnabled,
        },
        update: { linkPreviewsEnabled: dto.linkPreviewsEnabled },
        select: { linkPreviewsEnabled: true },
      });

      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: 'PLATFORM_SETTINGS_UPDATED',
          entity: 'platform_settings',
          entityId: 'whatsapp.link_previews_enabled',
          metadata: {
            previousLinkPreviewsEnabled: previous?.linkPreviewsEnabled ?? false,
            linkPreviewsEnabled: settings.linkPreviewsEnabled,
          } satisfies Prisma.InputJsonObject,
        },
      });

      return settings;
    });

    return { linkPreviewsEnabled: updated.linkPreviewsEnabled };
  }
}
