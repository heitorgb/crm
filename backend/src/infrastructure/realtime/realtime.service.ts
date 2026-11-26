import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server?: Server;

  constructor(private readonly prisma: PrismaService) {}

  attach(server: Server): void {
    this.server = server;
  }

  detach(): void {
    this.server = undefined;
  }

  tenantRoom(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  tenantAdminRoom(tenantId: string): string {
    return `tenant:${tenantId}:admin`;
  }

  userRoom(tenantId: string, userId: string): string {
    return `tenant:${tenantId}:user:${userId}`;
  }

  conversationRoom(tenantId: string, conversationId: string): string {
    return `tenant:${tenantId}:conversation:${conversationId}`;
  }

  allConversationsRoom(tenantId: string): string {
    return `tenant:${tenantId}:conversations`;
  }

  instanceRoom(tenantId: string, instanceId: string): string {
    return `tenant:${tenantId}:instance:${instanceId}`;
  }

  /** Rooms that receive conversation events: every instance, or only the listed ones. */
  conversationRooms(tenantId: string, instanceIds: string[] | 'all'): string[] {
    return instanceIds === 'all'
      ? [this.allConversationsRoom(tenantId)]
      : instanceIds.map((instanceId) => this.instanceRoom(tenantId, instanceId));
  }

  emitToTenant(tenantId: string, event: string, payload: unknown): void {
    this.server?.to(this.tenantRoom(tenantId)).emit(event, payload);
  }

  /** Conversation and message events reach only members allowed to see the instance's conversations. */
  emitConversationEvent(tenantId: string, instanceId: string, event: string, payload: unknown): void {
    this.server
      ?.to([this.allConversationsRoom(tenantId), this.instanceRoom(tenantId, instanceId)])
      .emit(event, payload);
  }

  /** Same as emitConversationEvent when only the conversation id is at hand. */
  async emitToConversationAudience(
    tenantId: string,
    conversationId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    if (!this.server) return;
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { whatsappInstanceId: true },
    });
    if (conversation) this.emitConversationEvent(tenantId, conversation.whatsappInstanceId, event, payload);
  }

  async replaceConversationRooms(tenantId: string, userId: string, rooms: string[]): Promise<void> {
    if (!this.server) return;
    const allRoom = this.allConversationsRoom(tenantId);
    const instancePrefix = `tenant:${tenantId}:instance:`;
    const sockets = await this.server.in(this.userRoom(tenantId, userId)).fetchSockets();
    for (const socket of sockets) {
      for (const room of socket.rooms) {
        if (room === allRoom || room.startsWith(instancePrefix)) socket.leave(room);
      }
      socket.join(rooms);
    }
  }

  emitToTenantAdmins(tenantId: string, event: string, payload: unknown): void {
    this.server?.to(this.tenantAdminRoom(tenantId)).emit(event, payload);
  }

  emitToUser(tenantId: string, userId: string, event: string, payload: unknown): void {
    this.server?.to(this.userRoom(tenantId, userId)).emit(event, payload);
  }

  emitToConversation(
    tenantId: string,
    conversationId: string,
    event: string,
    payload: unknown,
  ): void {
    this.server?.to(this.conversationRoom(tenantId, conversationId)).emit(event, payload);
  }
}
