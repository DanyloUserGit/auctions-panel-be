// apps/browser-worker/src/browser-worker.controller.ts
import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { chromium } from 'playwright';

@Controller()
export class BrowserWorkerController {
  @EventPattern('start_browser_session')
  async handleStartSession(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    console.log(`Отримано завдання на запуск сесії: ${data.sessionId}`);

    try {
      // 1. Тут пізніше буде код для Xvfb та FFmpeg
      const browser = await chromium.launch({
        headless: false, // Змінимо на false, коли додамо Xvfb
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,720'],
      });

      const page = await browser.newPage();
      await page.goto('https://example.com'); // Тут буде URL з data.auctionId

      console.log(`Браузер для сесії ${data.sessionId} успішно запущено.`);
      channel.ack(originalMsg);
    } catch (error) {
      console.error(`Помилка запуску сесії:`, error);
      channel.nack(originalMsg, false, false);
    }
  }
}
