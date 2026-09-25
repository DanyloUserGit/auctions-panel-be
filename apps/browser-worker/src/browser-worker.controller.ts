import { Controller, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ClientProxy, Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { BrowserService, DEFAULT_STREAM, ProxySettings, StreamSettings } from './browser-worker.service';
import { ClientRules } from './rules/page-rules';
import { WebrtcService } from './webrtc/webrtc.service';

type StartPayload = {
  sessionId: string;
  auctionUrl: string;
  width: number;
  height: number;
  authEmail: string;
  authPassword: string;
  stream?: StreamSettings;
  proxy?: ProxySettings;
};

@Controller()
export class BrowserWorkerController implements OnApplicationBootstrap {
  private readonly logger = new Logger(BrowserWorkerController.name);

  constructor(
    private readonly browserService: BrowserService,
    private readonly webrtcService: WebrtcService,
    @Inject('API_CLIENT') private apiClient: ClientProxy,
  ) { }

  // Після (пере)запуску воркера браузерів немає: API закриває «активні» сесії, вкладки показують помилку.
  onApplicationBootstrap() {
    this.webrtcService.onClientFailure = (sessionId, clientId) =>
      this.apiClient.emit('session.client_failed', {
        sessionId,
        clientId,
        message: 'Не вдалося відкрити сторінку аукціону в трансляції. Спробуйте підключитися знову.',
      });

    this.apiClient.emit('worker.started', { startedAt: new Date().toISOString() }).subscribe({
      error: (err) => this.logger.error('Не вдалося повідомити API про запуск воркера', err),
    });
  }

  private ack(context: RmqContext) {
    context.getChannelRef().ack(context.getMessage());
  }

  @EventPattern('start_browser_session')
  async handleStartSession(@Payload() data: StartPayload, @Ctx() context: RmqContext) {
    try {
      await this.browserService.launchSession(
        data.sessionId,
        data.auctionUrl,
        { width: data.width, height: data.height },
        { email: data.authEmail, password: data.authPassword },
        data.stream ?? DEFAULT_STREAM,
        data.proxy,
      );
    } finally {
      // Помилку запуску вже повідомлено API (session.failed); повторна доставка не допоможе.
      this.ack(context);
    }
  }

  @EventPattern('stop_browser_session')
  async handleStopSession(@Payload() data: { sessionId: string }, @Ctx() context: RmqContext) {
    try {
      await this.webrtcService.closeConnection(data.sessionId);
      await this.browserService.stopSession(data.sessionId);
    } catch (error) {
      this.logger.error(`Помилка під час зупинки сесії ${data.sessionId}`, error as Error);
    } finally {
      this.ack(context);
    }
  }

  @EventPattern('webrtc_signal_to_worker')
  async handleWebrtcSignal(
    @Payload() data: { userId: string; sessionId: string; clientId: string; signalData: any; width: number; height: number; rules?: ClientRules },
    @Ctx() context: RmqContext,
  ) {
    try {
      if (data.signalData?.type === 'offer') {
        const answer = await this.webrtcService.handleOffer(data, (candidate) => {
          this.apiClient.emit('webrtc_signal_to_client', {
            sessionId: data.sessionId,
            clientId: data.clientId,
            signalData: { type: 'candidate', candidate },
          });
        });
        this.apiClient.emit('webrtc_signal_to_client', {
          sessionId: data.sessionId,
          clientId: data.clientId,
          signalData: { type: 'answer', sdp: answer.sdp },
        });
      } else if (data.signalData?.candidate) {
        await this.webrtcService.addIceCandidate(data.sessionId, data.clientId, data.signalData.candidate);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Помилка обробки сигналу WebRTC: ${message}`);
      this.apiClient.emit('session.client_failed', {
        sessionId: data.sessionId,
        clientId: data.clientId,
        message: 'Не вдалося відкрити трансляцію. Спробуйте підключитися знову.',
      });
    } finally {
      this.ack(context);
    }
  }

  @EventPattern('webrtc_client_disconnect')
  async handleClientDisconnect(@Payload() data: { sessionId: string; clientId: string }, @Ctx() context: RmqContext) {
    try {
      await this.webrtcService.closeClientConnection(data.sessionId, data.clientId);
    } catch (error) {
      this.logger.error('Помилка відключення клієнта', error as Error);
    } finally {
      this.ack(context);
    }
  }
}
