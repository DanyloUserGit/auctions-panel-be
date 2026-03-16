// apps/browser-worker/src/browser/browser.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { BrowserContext, chromium, Page } from 'playwright';
import UserAgent from 'user-agents';

interface SessionConfig {
  url: string;
  viewport: { width: number; height: number };
  allowedRoutes: string[];
  forbiddenSelectors: string[];
}

interface ActiveSession {
  context: BrowserContext;
  config: SessionConfig;
}

@Injectable()
export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);

  // Зберігаємо вкладки для КОЖНОГО клієнта: Map<sessionId, Map<clientId, Page>>
  private activePages = new Map<string, Map<string, Page>>();
  private sessions = new Map<string, ActiveSession>();

  private frameIntervals = new Map<string, NodeJS.Timeout>();

  async stopSession(sessionId: string): Promise<void> {
    this.logger.log(`[BrowserService] Починаємо процес зупинки сесії: ${sessionId}`);
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const clientPages = this.activePages.get(sessionId);
      if (clientPages) {
        for (const [clientId, page] of clientPages.entries()) {
          if (!page.isClosed()) await page.close();
        }
      }
      await session.context.close();
    } catch (error) {
      this.logger.error(`[BrowserService] Помилка закриття для ${sessionId}:`, error);
    } finally {
      this.sessions.delete(sessionId);
      this.activePages.delete(sessionId);
    }
  }

  // Запуск БАЗОВОЇ сесії (налаштовує лише Context, але не створює сторінки для відео)
  async launchSession(
    sessionId: string,
    url: string,
    viewport: { width: number; height: number },
    authData: { email: string; password: string },
    allowedRoutes: string[],
    forbiddenSelectors: string[]
  ) {
    const userDataDir = path.join('/tmp/playwright_sessions', sessionId);
    const userAgent = new UserAgent();

    // Зверни увагу: Xvfb і параметри дисплею тут більше не потрібні
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true, // Тепер можна використовувати справжній headless!
      viewport,
      userAgent: userAgent.toString(),
      ignoreHTTPSErrors: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    this.sessions.set(sessionId, {
      context,
      config: { url, viewport, allowedRoutes, forbiddenSelectors }
    });

    this.logger.log(`[BrowserService] Context для ${sessionId} успішно створено.`);
    return context;
  }

  // ✅ НОВИЙ МЕТОД: Створює сторінку для КОНКРЕТНОГО клієнта і запускає Screencast
  async addClientPage(
    sessionId: string,
    clientId: string,
    onFrame: (buffer: Buffer) => void
  ): Promise<Page | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const page = await session.context.newPage();

    if (!this.activePages.has(sessionId)) {
      this.activePages.set(sessionId, new Map());
    }
    this.activePages.get(sessionId)!.set(clientId, page);

    await page.goto(session.config.url, { waitUntil: 'domcontentloaded' });

    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      maxWidth: session.config.viewport.width,
      maxHeight: session.config.viewport.height,
    });

    // 1. Зберігаємо останній отриманий кадр
    let lastFrameBuffer: Buffer | null = null;
    const clientKey = `${ sessionId }_${ clientId } `;

    cdpSession.on('Page.screencastFrame', async (frameObject) => {
      await cdpSession.send('Page.screencastFrameAck', { sessionId: frameObject.sessionId }).catch(() => { });
      lastFrameBuffer = Buffer.from(frameObject.data, 'base64');
    });

    // 2. Створюємо "насос", який відправляє цей кадр у FFmpeg 30 разів на секунду
    const interval = setInterval(() => {
      if (lastFrameBuffer) {
        onFrame(lastFrameBuffer); // Відправляємо кадр, навіть якщо він не змінився
      }
    }, 1000 / 30); // ~33 мілісекунди

    this.frameIntervals.set(clientKey, interval);

    this.logger.log(`[BrowserService] Вкладку для клієнта ${ clientId } створено.Насос кадрів запущено.`);
    return page;
  }

  async removePageForClient(sessionId: string, clientId: string) {
    const clientKey = `${ sessionId }_${ clientId } `;

    // Зупиняємо відправку кадрів
    const interval = this.frameIntervals.get(clientKey);
    if (interval) {
      clearInterval(interval);
      this.frameIntervals.delete(clientKey);
    }

    const page = this.activePages.get(sessionId)?.get(clientId);
    if (page && !page.isClosed()) {
      await page.close();
      this.activePages.get(sessionId)?.delete(clientId);
    }
  }

  // Метод interact (передає кліки). Треба змінити, щоб шукав вкладку конкретного клієнта
  async interact(sessionId: string, clientId: string, action: any) {
    const page = this.activePages.get(sessionId)?.get(clientId);
    if (!page) return;

    try {
      switch (action.type) {
        case 'mousemove': await page.mouse.move(action.x, action.y); break;
        case 'mousedown':
          const downBtn = action.button === 2 ? 'right' : action.button === 1 ? 'middle' : 'left';
          await page.mouse.down({ button: downBtn }); break;
        case 'mouseup':
          const upBtn = action.button === 2 ? 'right' : action.button === 1 ? 'middle' : 'left';
          await page.mouse.up({ button: upBtn }); break;
        case 'wheel': await page.mouse.wheel(action.deltaX, action.deltaY); break;
        case 'keydown': await page.keyboard.down(action.key); break;
        case 'keyup': await page.keyboard.up(action.key); break;
      }
    } catch (e) {
      this.logger.debug(`[Browser] Помилка дії: ${ e.message } `);
    }
  }
}