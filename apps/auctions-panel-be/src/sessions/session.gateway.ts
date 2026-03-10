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
  ) { }

  handleConnection(client: Socket) {
    console.log(`Клієнт підключився: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Клієнт відключився: ${client.id}`);
    if (client.data.sessionId) {
      this.handleLeaveAuction(client);
    }
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

      client.data.sessionId = session.id;

      client.join(session.id);
      client.emit('session_ready', { sessionId: session.id });
    } catch (error) {
      console.error('❌ Помилка в Gateway (join_auction):', error.message); // ДОДАЙ ЦЕ
      client.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('leave_auction')
  async handleLeaveAuction(@ConnectedSocket() client: Socket) {
    const sessionId = client.data.sessionId;
    if (sessionId) {
      client.leave(sessionId);
      await this.sessionService.leaveSession(sessionId); // Зменшуємо лічильник
      this.rabbitClient
        .emit('webrtc_client_disconnect', { sessionId, clientId: client.id })
        .subscribe({
          error: (err) => console.error('Помилка відправки webrtc_client_disconnect:', err)
        });
      delete client.data.sessionId;
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
        next: (m) => console.log(`Відправлено до сесії: ${payload.sessionId}`),
        error: (err) => console.error('❌ Помилка передачі WebRTC сигналу:', err),
      });
  }
}
