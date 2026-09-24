import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server?: Server;

  attach(server: Server): void {
    this.server = server;
  }

  detach(): void {
    this.server = undefined;
  }

  tenantRoom(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  userRoom(tenantId: string, userId: string): string {
    return `tenant:${tenantId}:user:${userId}`;
  }

  conversationRoom(tenantId: string, conversationId: string): string {
    return `tenant:${tenantId}:conversation:${conversationId}`;
  }

  emitToTenant(tenantId: string, event: string, payload: unknown): void {
    this.server?.to(this.tenantRoom(tenantId)).emit(event, payload);
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
