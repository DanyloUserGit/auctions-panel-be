import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SessionsService } from './sessions.service';
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://auctions-be.duckdns.org'],
  },
})
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sessionService: SessionsService,
    @Inject('WORKER_SERVICE') private rabbitClient: ClientProxy
  ) {}

  handleConnection(client: Socket) {
    console.log(`Клієнт підключився: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Клієнт відключився: ${client.id}`);
    // Тут в майбутньому треба зменшувати activeConnections у БД
  }

  // 1. Клієнт просить підключитися до аукціону
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
      // Валідація і створення сесії через наш сервіс
      const session = await this.sessionService.initializeSession(
        data.userId,
        data.auctionId,
        data.auctionAuthId,
        data.width,
        data.height,
        data.sessionId
      );

      // Додаємо клієнта в "кімнату" (room) сокетів, названу ID сесії
      client.join(session.id);

      // Повідомляємо React, що сесію ініціалізовано, можна починати WebRTC процес
      client.emit('session_ready', { sessionId: session.id });
    } catch (error) {
      console.error('❌ Помилка в Gateway (join_auction):', error.message); // ДОДАЙ ЦЕ
      client.emit('error', { message: error.message });
    }
  }

  // 2. Пересилка WebRTC Signaling даних від React до Worker-а
  @SubscribeMessage('webrtc_signal')
  handleWebRtcSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; signalData: any; width: number; height: number }
  ) {
    // ДОДАНО .subscribe() !!!
    this.rabbitClient
      .emit('webrtc_signal_to_worker', {
        sessionId: payload.sessionId,
        clientId: client.id,
        signalData: payload.signalData,
        width: payload.width,
        height: payload.height,
      })
      .subscribe({
        error: (err) => console.error('❌ Помилка передачі WebRTC сигналу:', err),
      });
  }
}
