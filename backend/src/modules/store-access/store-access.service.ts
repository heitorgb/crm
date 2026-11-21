import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service.js';
import { ConversationNotFoundError } from '../conversations/conversations.errors.js';

export type StoreAccessScope =
  | { restricted: false }
  | { restricted: true; storeIds: string[]; instanceIds: string[] };

const UNRESTRICTED: StoreAccessScope = { restricted: false };

export function hasFullStoreAccess(role: string, linkedStoreCount: number): boolean {
  return role !== 'USER' || linkedStoreCount === 0;
}

/**
 * Members with the USER role who are linked to at least one store only reach
 * that store's orders and the conversations of the store's WhatsApp instance.
 * Owners, admins, system jobs and unlinked members keep full tenant access.
 */
@Injectable()
export class StoreAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly realtime: RealtimeService,
  ) {}

  current(): Promise<StoreAccessScope> {
    const { tenantId, membershipId, role } = this.tenantContext.requireContext();
    return this.forMembership(tenantId, membershipId, role);
  }

  async forMembership(tenantId: string, membershipId: string, role: string): Promise<StoreAccessScope> {
    if (hasFullStoreAccess(role, 1)) return UNRESTRICTED;
    const links = await this.prisma.tenantUserStore.findMany({
      where: { tenantId, tenantUserId: membershipId },
      select: { storeId: true, store: { select: { whatsappInstanceId: true } } },
    });
    if (hasFullStoreAccess(role, links.length)) return UNRESTRICTED;
    return {
      restricted: true,
      storeIds: links.map((link) => link.storeId),
      instanceIds: [...new Set(links.flatMap((link) => (link.store.whatsappInstanceId ? [link.store.whatsappInstanceId] : [])))],
    };
  }

  conversationFilter(scope: StoreAccessScope): Prisma.ConversationWhereInput {
    return scope.restricted ? { whatsappInstanceId: { in: scope.instanceIds } } : {};
  }

  storeOrderFilter(scope: StoreAccessScope): Prisma.StoreOrderWhereInput {
    return scope.restricted ? { storeId: { in: scope.storeIds } } : {};
  }

  storeFilter(scope: StoreAccessScope): Prisma.StoreWhereInput {
    return scope.restricted ? { id: { in: scope.storeIds } } : {};
  }

  instanceFilter(scope: StoreAccessScope): Prisma.WhatsAppInstanceWhereInput {
    return scope.restricted ? { id: { in: scope.instanceIds } } : {};
  }

  /** Members who may see conversations of the instance, for queries such as push device lookup. */
  membersReachingInstance(instanceId: string): Prisma.TenantUserWhereInput {
    return {
      OR: [
        { role: { not: 'USER' } },
        { storeAccess: { none: {} } },
        { storeAccess: { some: { store: { whatsappInstanceId: instanceId } } } },
      ],
    };
  }

  canAccessInstance(scope: StoreAccessScope, instanceId: string): boolean {
    return !scope.restricted || scope.instanceIds.includes(instanceId);
  }

  canAccessStore(scope: StoreAccessScope, storeId: string): boolean {
    return !scope.restricted || scope.storeIds.includes(storeId);
  }

  conversationRooms(tenantId: string, scope: StoreAccessScope): string[] {
    return this.realtime.conversationRooms(tenantId, scope.restricted ? scope.instanceIds : 'all');
  }

  async refreshRealtimeRooms(tenantId: string, membershipId: string, userId: string, role: string): Promise<void> {
    const scope = await this.forMembership(tenantId, membershipId, role);
    await this.realtime.replaceConversationRooms(tenantId, userId, this.conversationRooms(tenantId, scope));
  }

  async refreshRealtimeRoomsForStore(tenantId: string, storeId: string): Promise<void> {
    const members = await this.prisma.tenantUser.findMany({
      where: { tenantId, storeAccess: { some: { storeId } } },
      select: { id: true, userId: true, role: true },
    });
    for (const member of members) {
      await this.refreshRealtimeRooms(tenantId, member.id, member.userId, member.role);
    }
  }

  /** Answers 404 for conversations the member cannot reach, so their existence is not revealed. */
  async assertConversations(conversationIds: string[]): Promise<void> {
    const ids = [...new Set(conversationIds)];
    if (ids.length === 0) return;
    const scope = await this.current();
    if (!scope.restricted) return;
    const { tenantId } = this.tenantContext.requireContext();
    const reachable = await this.prisma.conversation.count({
      where: { tenantId, id: { in: ids }, whatsappInstanceId: { in: scope.instanceIds } },
    });
    if (reachable !== ids.length) throw new ConversationNotFoundError();
  }
}
