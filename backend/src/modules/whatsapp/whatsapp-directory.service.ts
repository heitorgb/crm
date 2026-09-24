import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { EvolutionClient } from './evolution/evolution.client.js';

const AVATAR_TTL_MS = 6 * 60 * 60 * 1000;
const BACKFILL_LIMIT = 100;

export interface GroupInfo {
  name: string | null;
  avatarUrl: string | null;
}

export interface ResolveAvatarInput {
  tenantId: string;
  whatsappInstanceId: string;
  instanceName: string;
  jid: string;
}

@Injectable()
export class WhatsAppDirectoryService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppDirectoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionClient,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }
    void this.backfillMissingGroups();
  }

  /**
   * Groups imported before the metadata feature existed have no name/avatar.
   * Best-effort, bounded refresh at boot so they self-heal without a new message.
   */
  private async backfillMissingGroups(): Promise<void> {
    if (!this.evolution.configured) {
      return;
    }

    try {
      const conversations = await this.prisma.conversation.findMany({
        where: {
          externalContactId: { endsWith: '@g.us' },
          OR: [{ isGroup: false }, { groupName: null }],
        },
        select: {
          id: true,
          tenantId: true,
          externalContactId: true,
          instance: { select: { instanceName: true } },
        },
        take: BACKFILL_LIMIT,
      });

      for (const conversation of conversations) {
        if (!conversation.externalContactId) {
          continue;
        }

        const info = await this.resolveGroupInfo(
          conversation.instance.instanceName,
          conversation.externalContactId,
        );

        const data: Prisma.ConversationUpdateInput = { isGroup: true };
        if (info?.name) data.groupName = info.name;
        if (info?.avatarUrl) data.avatarUrl = info.avatarUrl;

        await this.prisma.conversation.update({ where: { id: conversation.id }, data });
        this.realtime.emitToTenant(conversation.tenantId, 'conversation.updated', {
          conversationId: conversation.id,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Group metadata backfill failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /** Best-effort group metadata lookup; never throws so the webhook keeps working. */
  async resolveGroupInfo(instanceName: string, groupJid: string): Promise<GroupInfo | null> {
    if (!this.evolution.configured) {
      return null;
    }

    try {
      const info = await this.evolution.findGroupInfos(instanceName, groupJid);
      if (!info) {
        return null;
      }
      return { name: info.subject, avatarUrl: info.pictureUrl };
    } catch (error) {
      this.logger.warn(
        `Could not resolve group ${groupJid}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }

  /** Tenant-scoped avatar lookup backed by a short-lived cache. */
  async resolveAvatar(input: ResolveAvatarInput): Promise<string | null> {
    const cached = await this.prisma.whatsAppAvatar.findUnique({
      where: {
        whatsappInstanceId_jid: { whatsappInstanceId: input.whatsappInstanceId, jid: input.jid },
      },
      select: { url: true, fetchedAt: true },
    });

    if (cached && Date.now() - cached.fetchedAt.getTime() < AVATAR_TTL_MS) {
      return cached.url;
    }

    if (!this.evolution.configured) {
      return cached?.url ?? null;
    }

    let url: string | null;
    try {
      url = await this.evolution.fetchProfilePictureUrl(input.instanceName, input.jid);
    } catch (error) {
      this.logger.warn(
        `Could not resolve avatar for ${input.jid}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return cached?.url ?? null;
    }

    await this.prisma.whatsAppAvatar.upsert({
      where: {
        whatsappInstanceId_jid: { whatsappInstanceId: input.whatsappInstanceId, jid: input.jid },
      },
      create: {
        tenantId: input.tenantId,
        whatsappInstanceId: input.whatsappInstanceId,
        jid: input.jid,
        url,
        fetchedAt: new Date(),
      },
      update: { url, fetchedAt: new Date() },
    });

    return url;
  }
}
