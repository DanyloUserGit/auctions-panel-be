import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { authenticateSocket } from '../auth/socket-auth';
import { corsOrigins } from '../utils/cors';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRoomNotifier } from './session-room.notifier';
import { SessionRulesService } from './session-rules.service';
import { SessionsService } from './sessions.service';

// Скільки чекаємо на повернення вкладки після обриву сокета (оновлення сторінки, мережа).
const RECONNECT_GRACE_MS = 10_000;

type JoinPayload = {
  auctionId: string;
  auctionAuthId: string;
  width: number;
  height: number;
  // Сесія, яку вкладка вже мала (відновлення після оновлення сторінки).
  sessionId?: string;
  // Ідентифікатор запиту вкладки: повертається у session_ready / session_error, щоб
  // відповідь потрапила саме в ту вкладку, яка її чекає.
  requestId?: string;
};

@WebSocketGateway({
  cors: { origin: corsOrigins(), credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class SessionGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SessionGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessionService: SessionsService,
    private readonly rules: SessionRulesService,
    private readonly rooms: SessionRoomNotifier,
    @Inject('WORKER_SERVICE') private rabbitClient: ClientProxy,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) { }

  afterInit(server: Server) {
    this.rooms.attach(server);
  }

  private authenticate(client: Socket): Promise<string | null> {
    return authenticateSocket(client, this.jwtService, this.config, this.prisma);
  }

  private sessionsOf(client: Socket): Set<string> {
    if (!client.data.sessions) client.data.sessions = new Set<string>();
    return client.data.sessions;
  }

  private closeWorkerPage(sessionId: string, clientId: string) {
    this.rabbitClient.emit('webrtc_client_disconnect', { sessionId, clientId }).subscribe({
      error: (err) => this.logger.error('Помилка відправки webrtc_client_disconnect', err),
    });
  }

  async handleConnection(client: Socket) {
    const userId = await this.authenticate(client);
    if (!userId) {
      client.emit('session_error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  // Вкладки цього сокета закриваються не одразу: після оновлення сторінки нова вкладка
  // підхоплює своє підключення (SessionsService.connect), і тоді закривати вже нічого.
  handleDisconnect(client: Socket) {
    const sessions = [...this.sessionsOf(client)];
    if (sessions.length === 0) return;

    setTimeout(() => {
      for (const sessionId of sessions) {
        this.sessionService
          .disconnectClient(sessionId, client.id, false)
          .catch((e) => this.logger.error(`Помилка від'єднання клієнта від ${sessionId}`, e));
        this.closeWorkerPage(sessionId, client.id);
      }
    }, RECONNECT_GRACE_MS).unref();
  }

  @SubscribeMessage('join_auction')
  async handleJoinAuction(@ConnectedSocket() client: Socket, @MessageBody() data: JoinPayload) {
    const requestId = data?.requestId;
    const userId = await this.authenticate(client);
    if (!userId) {
      client.emit('session_error', { requestId, sessionId: data?.sessionId, message: 'Unauthorized' });
      return;
    }

    try {
      const session = await this.sessionService.connect({
        userId,
        clientId: client.id,
        auctionId: data.auctionId,
        auctionAuthId: data.auctionAuthId,
        width: data.width,
        height: data.height,
        preferredSessionId: data.sessionId,
      });

      this.sessionsOf(client).add(session.id);
      client.join(session.id);
      client.emit('session_ready', { requestId, sessionId: session.id });
    } catch (error) {
      // Клієнту - лише текст помилки, без внутрішньої структури винятку.
      client.emit('session_error', {
        requestId,
        sessionId: data?.sessionId,
        message: error instanceof Error ? error.message : 'Не вдалося підключитися до сесії',
      });
    }
  }

  // Закриття вкладки користувачем: від'єднання одразу, лічильник підключень зменшується.
  @SubscribeMessage('leave_auction')
  async handleLeaveAuction(@ConnectedSocket() client: Socket, @MessageBody() payload: { sessionId: string }) {
    const sessionId = payload?.sessionId;
    if (!sessionId || !(await this.authenticate(client))) return;
    if (!this.sessionsOf(client).has(sessionId)) return;

    this.sessionsOf(client).delete(sessionId);
    client.leave(sessionId);
    await this.sessionService.disconnectClient(sessionId, client.id, true);
    this.closeWorkerPage(sessionId, client.id);
  }

  @SubscribeMessage('webrtc_signal')
  async handleWebRtcSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; signalData: any; width: number; height: number },
  ) {
    if (!payload?.sessionId || !(await this.authenticate(client))) return;

    // Сигнали WebRTC - лише для вкладки, яку цей сокет відкрив через join_auction.
    const connection = await this.sessionService.getClientConnection(payload.sessionId, client.id);
    if (!connection) return;

    // Разом з offer воркер отримує правила саме цього користувача (статус, заборони).
    const rules = payload.signalData?.type === 'offer'
      ? await this.rules.forUser(connection.userId, connection.session.auctionId)
      : undefined;

    this.rabbitClient
      .emit('webrtc_signal_to_worker', {
        userId: connection.userId,
        sessionId: payload.sessionId,
        clientId: client.id,
        signalData: payload.signalData,
        width: payload.width,
        height: payload.height,
        rules,
      })
      .subscribe({
        error: (err) => this.logger.error('Помилка передачі WebRTC сигналу', err),
      });
  }
}
