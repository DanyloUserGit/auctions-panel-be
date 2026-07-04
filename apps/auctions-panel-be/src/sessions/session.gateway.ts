import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SessionsService } from './sessions.service';

// Додаємо інтерфейс для збереження контексту відключення
interface DisconnectData {
  timeout: NodeJS.Timeout;
  sessionId: string;
  auctionId: string;
  auctionAuthId: string;
}

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://auctions-be.duckdns.org', 'https://panel.caddyluck.com.ua'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  // Змінюємо тип мапи, щоб зберігати деталі сесії
  private disconnectTimeouts = new Map<string, DisconnectData>();

  constructor(
    private readonly sessionService: SessionsService,
    @Inject('WORKER_SERVICE') private rabbitClient: ClientProxy
  ) { }

  private async executeLeaveLogic(sessionId: string, clientId: string) {
    await this.sessionService.leaveSession(sessionId);
    this.rabbitClient
      .emit('webrtc_client_disconnect', { sessionId, clientId })
      .subscribe({
        error: (err) => console.error('Помилка відправки webrtc_client_disconnect:', err)
      });
  }

  handleConnection(client: Socket) {
    console.log(`Клієнт підключився: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Клієнт відключився: ${client.id}`);
    const sessions = client.data.sessions as Map<string, { auctionId: string; auctionAuthId: string }> | undefined;
    if (!sessions || sessions.size === 0) return;

    sessions.forEach((data, sessionId) => {
      // ВАЖЛИВО: якщо для цього sessionId вже є запланований таймаут
      // (наприклад, від попереднього швидкого reload) — прибираємо його,
      // інакше він завиcне і пізніше стре свіжіший запис/спричинить
      // зайвий leaveSession.
      const existing = this.disconnectTimeouts.get(sessionId);
      if (existing) {
        clearTimeout(existing.timeout);
        this.disconnectTimeouts.delete(sessionId);
      }

      const timeout = setTimeout(() => {
        console.log(`⏳ Час вийшов. Остаточно видаляємо клієнта з сесії ${sessionId}`);
        this.executeLeaveLogic(sessionId, client.id).catch(console.error);
        this.disconnectTimeouts.delete(sessionId);
      }, 10000);

      this.disconnectTimeouts.set(sessionId, {
        timeout,
        sessionId,
        auctionId: data.auctionId,
        auctionAuthId: data.auctionAuthId,
      });
    });
  }

  @SubscribeMessage('join_auction')
  async handleJoinAuction(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      userId: string;
      auctionId: string;
      auctionAuthId: string;
      width: number;
      height: number;
      sessionId?: string;
    }
  ) {
    try {
      if (data.sessionId && client.rooms.has(data.sessionId)) {
        console.log(`Клієнт вже знаходиться в кімнаті сесії ${data.sessionId}, пропускаємо інкремент`);
        client.emit('session_ready', { sessionId: data.sessionId });
        return;
      }
      let isReconect = false;

      // Перевіряємо, чи є юзер в мапі на відключення
      if (data.sessionId && this.disconnectTimeouts.has(data.sessionId)) {
        const storedData = this.disconnectTimeouts.get(data.sessionId)!;

        if (storedData.auctionId === data.auctionId && storedData.auctionAuthId === data.auctionAuthId) {
          clearTimeout(storedData.timeout);
          this.disconnectTimeouts.delete(data.sessionId);
          console.log(`Скасовано відключення для сесії ${data.sessionId} (реконект)`);
          isReconect = true;
        } else {
          console.log(`Примусово закриваємо стару сесію.`);
          clearTimeout(storedData.timeout);
          this.disconnectTimeouts.delete(data.sessionId);
          this.executeLeaveLogic(storedData.sessionId, client.id).catch(console.error);
          isReconect = false;
        }
      }

      const session = await this.sessionService.initializeSession(
        isReconect,
        data.userId,
        data.auctionId,
        data.auctionAuthId,
        data.width,
        data.height,
        data.sessionId
      );

      if (!client.data.sessions) {
        client.data.sessions = new Map<string, { auctionId: string; auctionAuthId: string }>();
      }
      // Додаємо нову сесію в мапу сокета, не затираючи попередні!
      client.data.sessions.set(session.id, {
        auctionId: data.auctionId,
        auctionAuthId: data.auctionAuthId
      });

      client.join(session.id);
      client.emit('session_ready', { sessionId: session.id });
    } catch (error) {
      console.error('❌ Помилка в Gateway (join_auction):', error);
      client.emit('error', { message: error });
    }
  }

  @SubscribeMessage('leave_auction')
  async handleLeaveAuction(@ConnectedSocket() client: Socket, @MessageBody() payload: { sessionId: string }) {
    const sessionId = payload?.sessionId;
    if (!sessionId) return;

    client.leave(sessionId);

    // Явний вихід — прибираємо будь-який відкладений тихий-дисконект таймер
    // для цієї сесії, щоб він пізніше не "воскресив" її своєю логікою.
    const pending = this.disconnectTimeouts.get(sessionId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.disconnectTimeouts.delete(sessionId);
    }

    await this.sessionService.leaveSession(sessionId, true); // immediate = true

    this.rabbitClient
      .emit('webrtc_client_disconnect', { sessionId, clientId: client.id })
      .subscribe({
        error: (err) => console.error('Помилка відправки webrtc_client_disconnect:', err),
      });

    if (client.data.sessions) {
      client.data.sessions.delete(sessionId);
    }
  }

  @SubscribeMessage('webrtc_signal')
  handleWebRtcSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userId: string, sessionId: string; signalData: any; width: number; height: number }
  ) {
    this.rabbitClient
      .emit('webrtc_signal_to_worker', {
        userId: payload.userId,
        sessionId: payload.sessionId,
        clientId: client.id,
        signalData: payload.signalData,
        width: payload.width,
        height: payload.height,
      })
      .subscribe({
        next: (m) => console.log(`Відправлено до сесії: ${payload.sessionId}`),
        error: (err) => console.error('❌ Помилка передачі WebRTC сигналу:', err),
      });
  }
}