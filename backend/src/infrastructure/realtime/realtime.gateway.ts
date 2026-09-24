import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { Env } from '../../config/env.validation.js';
import { MembershipsService } from '../../modules/memberships/memberships.service.js';
import { RealtimeService } from './realtime.service.js';

interface SocketAuthPayload {
  sub?: string;
  tenantId?: string;
}

@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly memberships: MembershipsService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = extractToken(socket);
      const payload = await this.jwt.verifyAsync<SocketAuthPayload>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });

      if (!payload.sub || !payload.tenantId) {
        throw new Error('Incomplete token');
      }

      const context = await this.memberships.resolveContext(payload.sub, payload.tenantId);

      await socket.join(this.realtime.tenantRoom(context.tenantId));
      await socket.join(this.realtime.userRoom(context.tenantId, context.userId));

      socket.data.tenantId = context.tenantId;
      socket.data.userId = context.userId;
    } catch {
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    this.logger.debug(`Realtime client disconnected: ${socket.id}`);
  }
}

function extractToken(socket: Socket): string {
  const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) {
    return fromAuth;
  }

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7);
  }

  throw new Error('Missing token');
}
