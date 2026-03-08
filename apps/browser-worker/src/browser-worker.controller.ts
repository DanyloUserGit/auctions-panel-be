// apps/browser-worker/src/browser-worker.controller.ts
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

  // 1. Команда на запуск сесії (приходить з Main API)
  @EventPattern('start_browser_session')
  async handleStartSession(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    console.log(`[Worker] Отримано завдання на запуск сесії: ${data.sessionId}`);

    try {
      // Запускаємо Playwright з усіма обмеженнями
      const res = await this.browserService.launchSession(
        data.sessionId,
        data.auctionUrl,
        { width: data.width, height: data.height },
        { email: data.authEmail, password: data.authPassword },
        data.allowedRoutes || [],
        data.forbiddenSelectors || []
      );
      console.log(
        data.sessionId,
        data.auctionUrl,
        { width: data.width, height: data.height },
        { email: data.authEmail, password: data.authPassword },
        data.allowedRoutes || [],
        data.forbiddenSelectors || []
      );
      console.log(`[Worker] Playwright успішно запущено для сесії: ${data.sessionId}`);


      channel.ack(originalMsg);
    } catch (error) {
      console.error(`[Worker] Помилка під час запуску Playwright:`, error);
      // Відхиляємо повідомлення, щоб воно не висіло в черзі вічно
      channel.nack(originalMsg, false, false);
    }
  }
  @EventPattern('stop_browser_session')
  async handleStopSession(@Payload() data: { sessionId: string }, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    console.log(`[Worker] Отримано завдання на зупинку сесії: ${data.sessionId}`);

    try {
      // 1. Зупиняємо браузер/Playwright
      await this.browserService.stopSession(data.sessionId);

      // 2. Очищаємо WebRTC з'єднання, якщо воно не закривається автоматично разом з браузером
      await this.webrtcService.closeConnection(data.sessionId);

      console.log(`[Worker] Сесію успішно зупинено та очищено: ${data.sessionId}`);

      // Підтверджуємо успішну обробку повідомлення
      channel.ack(originalMsg);
    } catch (error) {
      console.error(`[Worker] Помилка під час зупинки сесії ${data.sessionId}:`, error);
      // Відхиляємо повідомлення, щоб воно видалилося з черги (або пішло в Dead Letter Queue)
      channel.nack(originalMsg, false, false);
    }
  }

  // 2. Команда на обробку WebRTC Signaling (SDP Offer від React)
  @EventPattern('webrtc_signal_to_worker')
  async handleWebrtcSignal(@Payload() data: any) {
    if (data.signalData.type === 'offer') {
      const answer = await this.webrtcService.handleOffer(
        data.sessionId,
        data.clientId, 
        data.signalData,
        { width: data.width, height: data.height },
        (candidate) => {
          this.apiClient.emit('webrtc_signal_to_client', {
            sessionId: data.sessionId,
            clientId: data.clientId,
            signalData: { type: 'candidate', candidate },
          });
        }
      );

      this.apiClient.emit('webrtc_signal_to_client', {
        sessionId: data.sessionId,
        clientId: data.clientId, // ВАЖЛИВО
        signalData: { type: 'answer', sdp: answer.sdp },
      });
    }
  }
  @EventPattern('webrtc_client_disconnect')
  async handleClientDisconnect(@Payload() data: { sessionId: string; clientId: string }) {
    await this.webrtcService.closeClientConnection(data.sessionId, data.clientId);
  }
}
