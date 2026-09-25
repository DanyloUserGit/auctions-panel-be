import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

// Доступ до кімнат сокетів сесій із сервісів (завершення адміном, таймаут, збій воркера):
// сервер реєструє SessionGateway після ініціалізації.
@Injectable()
export class SessionRoomNotifier {
  private server?: Server;

  attach(server: Server) {
    this.server = server;
  }

  emitToSession(sessionId: string, event: string, payload: Record<string, unknown>) {
    this.server?.to(sessionId).emit(event, { sessionId, ...payload });
  }

  // Чи під'єднаний зараз сокет із цим id (вкладка живе).
  isClientConnected(clientId: string | null | undefined): boolean {
    return !!clientId && !!this.server?.sockets.sockets.has(clientId);
  }

  leaveRoom(sessionId: string) {
    this.server?.in(sessionId).socketsLeave(sessionId);
  }
}
