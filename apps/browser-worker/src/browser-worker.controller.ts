// apps/browser-worker/src/browser-worker.controller.ts
import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { BrowserService } from './browser-worker.service';
import { WebrtcService } from '../webrtc/webrtc.service';


@Controller()
export class BrowserWorkerController {
  constructor(
    private readonly browserService: BrowserService,
    private readonly webrtcService: WebrtcService,
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
      console.log(        data.sessionId,
        data.auctionUrl,
        { width: data.width, height: data.height },
        { email: data.authEmail, password: data.authPassword },
        data.allowedRoutes || [],
        data.forbiddenSelectors || [])
      console.log(`[Worker] Playwright успішно запущено для сесії: ${data.sessionId}`);

      // ПРАВИЛЬНО: Підтверджуємо RabbitMQ, що ми обробили саме його ПОВІДОМЛЕННЯ
      channel.ack(originalMsg);
    } catch (error) {
      console.error(`[Worker] Помилка під час запуску Playwright:`, error);
      // Відхиляємо повідомлення, щоб воно не висіло в черзі вічно
      channel.nack(originalMsg, false, false);
    }
  }

  // 2. Команда на обробку WebRTC Signaling (SDP Offer від React)
  @EventPattern('webrtc_signal_to_worker')
  async handleWebrtcSignal(@Payload() data: any) {
    if (data.signalData.type === 'offer') {
      // Генеруємо Answer
      const answer = await this.webrtcService.handleOffer(data.sessionId, data.signalData, { width: data.width, height: data.height });

      // Відправляємо Answer назад у Main API (щоб він передав його в React)
      // В реальному додатку тут виклик rabbitClient.emit('webrtc_signal_to_client', ...)
    }
  }
}