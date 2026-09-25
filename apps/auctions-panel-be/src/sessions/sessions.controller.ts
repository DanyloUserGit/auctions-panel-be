import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { SessionGateway } from './session.gateway';
import { SessionsService } from './sessions.service';

// Події від browser-worker (RabbitMQ).
@Controller()
export class SessionsController {
  private readonly logger = new Logger(SessionsController.name);

  constructor(
    private readonly sessionGateway: SessionGateway,
    private readonly sessionsService: SessionsService,
  ) { }

  // Сигнал WebRTC для конкретної вкладки; sessionId дозволяє клієнту передати його саме їй.
  @EventPattern('webrtc_signal_to_client')
  handleSignalFromWorker(@Payload() data: { sessionId: string; clientId: string; signalData: any }) {
    this.sessionGateway.server
      .to(data.clientId)
      .emit('webrtc_signal_from_worker', { sessionId: data.sessionId, signal: data.signalData });
  }

  // Дія користувача в трансляції (воркер надсилає не частіше ніж раз на кілька секунд).
  @EventPattern('session.activity')
  async handleActivity(@Payload() data: { sessionId: string; userId?: string }) {
    await this.sessionsService.touch(data.sessionId, data.userId).catch((e) => this.logger.error(e));
  }

  @EventPattern('session.failed')
  async handleFailure(@Payload() data: { sessionId: string; message: string }) {
    await this.sessionsService.handleWorkerFailure(data.sessionId, data.message).catch((e) => this.logger.error(e));
  }

  // Вкладку клієнта не вдалося відкрити: помилка показується лише в ній, інші вкладки працюють.
  @EventPattern('session.client_failed')
  handleClientFailure(@Payload() data: { sessionId: string; clientId: string; message: string }) {
    this.sessionGateway.server
      .to(data.clientId)
      .emit('session_error', { sessionId: data.sessionId, message: data.message });
  }

  @EventPattern('worker.started')
  async handleWorkerStarted() {
    await this.sessionsService.handleWorkerRestart().catch((e) => this.logger.error(e));
  }
}
