import { Controller, Inject } from '@nestjs/common';
import { ClientProxy, Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { BrowserService } from './browser-worker.service';
import { WebrtcService } from './webrtc/webrtc.service';

@Controller()
export class BrowserWorkerController {
  constructor(
    private readonly browserService: BrowserService,
    private readonly webrtcService: WebrtcService,
    @Inject('API_CLIENT') private apiClient: ClientProxy
  ) { }

  @EventPattern('start_browser_session')
  async handleStartSession(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    console.log(`[Worker] Отримано завдання на запуск сесії: ${data.sessionId}`);

    try {
      await this.browserService.launchSession(
        data.userId,
        data.sessionId,
        data.auctionUrl,
        { width: data.width, height: data.height },
        { email: data.authEmail, password: data.authPassword },
        data.allowedRoutes || [],
        data.forbiddenSelectors || [],
        data.forbiddenRoutes || []
      );
      console.log(`[Worker] Playwright успішно запущено для сесії: ${data.sessionId}`);

      channel.ack(originalMsg);
    } catch (error) {
      console.error(`[Worker] Помилка під час запуску Playwright:`, error);
      channel.nack(originalMsg, false, false);
    }
  }

  @EventPattern('stop_browser_session')
  async handleStopSession(@Payload() data: { sessionId: string }, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    console.log(`[Worker] Отримано завдання на зупинку сесії: ${data.sessionId}`);

    try {
      await this.browserService.stopSession(data.sessionId);
      await this.webrtcService.closeConnection(data.sessionId);

      console.log(`[Worker] Сесію успішно зупинено та очищено: ${data.sessionId}`);
      channel.ack(originalMsg);
    } catch (error) {
      console.error(`[Worker] Помилка під час зупинки сесії ${data.sessionId}:`, error);
      channel.nack(originalMsg, false, false);
    }
  }

  @EventPattern('webrtc_signal_to_worker')
  async handleWebrtcSignal(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      if (data.signalData.type === 'offer') {
        const answer = await this.webrtcService.handleOffer(
          data.userId,
          data.sessionId,
          data.clientId,
          data.signalData,
          { width: data.width, height: data.height },
          (candidate) => {
            this.apiClient.emit('webrtc_signal_to_client', {
              sessionId: data.sessionId,
              clientId: data.clientId,
              signalData: { type: 'candidate', candidate },
            }).subscribe({
              error: (err) => console.error('Помилка відправки кандидата клієнту:', err)
            });
          }
        );

        this.apiClient.emit('webrtc_signal_to_client', {
          sessionId: data.sessionId,
          clientId: data.clientId,
          signalData: { type: 'answer', sdp: answer.sdp },
        }).subscribe({
          next: () => console.log(`[Worker] WebRTC Answer відправлено клієнту ${data.clientId}`),
          error: (err) => console.error('Помилка відправки Answer клієнту:', err)
        });
      }
      else if (data.signalData.type === 'candidate' || data.signalData.candidate) {
        await this.webrtcService.addIceCandidate(
          data.sessionId,
          data.clientId,
          data.signalData.candidate
        );
      }

      channel.ack(originalMsg);
    } catch (error) {
      console.error(`[Worker] Помилка обробки сигналу WebRTC:`, error);
      channel.nack(originalMsg, false, false);
    }
  }

  @EventPattern('webrtc_client_disconnect')
  async handleClientDisconnect(@Payload() data: { sessionId: string; clientId: string }, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.webrtcService.closeClientConnection(data.sessionId, data.clientId);

      channel.ack(originalMsg);
    } catch (error) {
      console.error(`[Worker] Помилка відключення клієнта:`, error);
      channel.nack(originalMsg, false, false);
    }
  }
}