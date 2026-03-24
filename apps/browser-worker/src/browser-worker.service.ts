// apps/browser-worker/src/browser/browser.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { BrowserContext, chromium, Page } from 'playwright';
import UserAgent from 'user-agents';
import { AuthStrategyRegistry } from './auth/auth.registry';

interface SessionConfig {
  url: string;
  viewport: { width: number; height: number };
  allowedRoutes: string[];
  forbiddenSelectors: string[];
  forbiddenRoutes: string[]; // <-- Додано в інтерфейс
}

interface ActiveSession {
  context: BrowserContext;
  config: SessionConfig;
}

@Injectable()
export class BrowserService {
  constructor(private readonly authRegistry: AuthStrategyRegistry) { }

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

  async launchSession(
    sessionId: string,
    url: string,
    viewport: { width: number; height: number },
    authData: { email: string; password: string },
    allowedRoutes: string[],
    forbiddenSelectors: string[],
    forbiddenRoutes: string[]
  ) {
    const userDataDir = path.join('/tmp/playwright_sessions', sessionId);
    const userAgent = new UserAgent();

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
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

    // --- 1. ПРАВИЛА МАРШРУТИЗАЦІЇ (РОУТИ) ---

    // 👇 ДОДАНО: Очищаємо масив від небезпечних значень (порожніх рядків та просто '/')
    this.logger.warn("forbiddenRoutes: ", forbiddenRoutes)
    const safeForbiddenRoutes = (forbiddenRoutes || [])
      .map(r => r.trim())
      .filter(r => r.length > 0 && r !== '/');

    // (А) Блокування на рівні мережі (для повних перезавантажень сторінки)
    await context.route('**/*', (route) => {
      const request = route.request();

      if (request.isNavigationRequest()) {
        const reqUrl = request.url();
        // Використовуємо ОЧИЩЕНИЙ масив safeForbiddenRoutes
        const isForbidden = safeForbiddenRoutes.some(fr => reqUrl.includes(fr));

        if (isForbidden) {
          this.logger.debug(`[Browser] Блокування переходу (заборонений роут): ${reqUrl}`);
          return route.abort('accessdenied');
        }
      }
      route.continue(); // Обов'язково пропускаємо всі інші запити
    });
    this.logger.warn("safeForbiddenRoutes: ", safeForbiddenRoutes)
    // (Б) Блокування на рівні SPA (для React/Angular/Vue роутерів)
    if (safeForbiddenRoutes.length > 0) {
      await context.addInitScript((routes: string[]) => {
        // Універсальна нормалізація URL (відкидаємо http://, кінцеві слеші та query параметри)
        const normalizeUrl = (u: string) => {
          if (!u) return '';
          try {
            // window.location.origin перетворює відносні шляхи SPA (/lots) на абсолютні
            const parsed = new URL(u, window.location.origin);
            return (parsed.hostname + parsed.pathname).replace(/\/+$/, '');
          } catch (e) {
            return u.replace(/\/+$/, ''); // Fallback
          }
        };

        const normalizedRoutes = routes.map(normalizeUrl);

        const isForbiddenUrl = (targetUrl: string) => {
          if (!targetUrl) return false;
          const targetNorm = normalizeUrl(targetUrl);
          // Тепер порівнюємо чисті шляхи, наприклад:
          // targetNorm: "carmarket.ayvens.com/en-es/lots"
          // normalizedRoutes: ["carmarket.ayvens.com/en-es/lots"]
          return normalizedRoutes.some(r => targetNorm.includes(r));
        };

        // 1. Перехоплюємо кліки на рівні window
        window.addEventListener('click', (e) => {
          const link = (e.target as HTMLElement).closest('a');
          if (link && link.href) {
            const rawHref = link.getAttribute('href');
            if (rawHref && (rawHref.startsWith('#') || rawHref.startsWith('javascript:'))) return;

            if (isForbiddenUrl(link.href)) {
              e.preventDefault();
              e.stopPropagation();
              console.warn(`[Блокування] Перехід на ${link.href} заборонено.`);
            }
          }
        }, true);

        // 2. Перехоплюємо History API
        const originalPushState = history.pushState;
        history.pushState = function (...args) {
          const url = args[2];
          if (url && isForbiddenUrl(url.toString())) return;
          return originalPushState.apply(this, args);
        };

        const originalReplaceState = history.replaceState;
        history.replaceState = function (...args) {
          const url = args[2];
          if (url && isForbiddenUrl(url.toString())) return;
          return originalReplaceState.apply(this, args);
        };
      }, safeForbiddenRoutes);

    }
    // --- КІНЕЦЬ ПРАВИЛ ---
    // --- 2. БЛОКУВАННЯ СЕЛЕКТОРІВ ---
    if (forbiddenSelectors && forbiddenSelectors.length > 0) {
      await context.addInitScript((selectors: string[]) => {
        // Функція для блокування події
        const blockEvent = (e: Event) => {
          const target = e.target as HTMLElement;
          if (!target) return;

          try {
            // Перевіряємо, чи сам елемент або його батьки підпадають під заборонений селектор
            const isForbidden = selectors.some(sel => target.matches(sel) || target.closest(sel));
            if (isForbidden) {
              e.stopPropagation(); // Зупиняємо поширення події
              e.preventDefault();  // Скасовуємо стандартну дію
            }
          } catch (err) {
            // Ігноруємо помилки синтаксису некоректних селекторів
          }
        };

        // Перехоплюємо події на етапі capture (найпершими), щоб сайт не встиг на них відреагувати
        window.addEventListener('mousedown', blockEvent, true);
        window.addEventListener('mouseup', blockEvent, true);
        window.addEventListener('click', blockEvent, true);
        window.addEventListener('keydown', blockEvent, true);
        window.addEventListener('keyup', blockEvent, true);

        // Візуально робимо елементи "неактивними" (напівпрозорі, курсор заборони, і зняття pointer-events)
        window.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = selectors.map(s => `${s} { opacity: 0.6 !important; cursor: not-allowed !important; pointer-events: none !important; }`).join('\n');
          document.head.appendChild(style);
        });
      }, forbiddenSelectors);
    }
    // --- КІНЕЦЬ ПРАВИЛ ---

    // Зберігаємо сесію (додано forbiddenRoutes)
    this.sessions.set(sessionId, {
      context,
      config: { url, viewport, allowedRoutes, forbiddenSelectors, forbiddenRoutes }
    });

    // Логіка автологіну
    if (url) {
      const strategy = this.authRegistry.get(url);
      if (strategy) {
        this.logger.log(`[BrowserService] Запуск автологіну через: ${strategy.url}`);
        const loginPage = await context.newPage();
        try {
          await strategy.login(loginPage, authData);
        } catch (error) {
          this.logger.error(`[BrowserService] Помилка автологіну:`, error);
        } finally {
          await loginPage.close();
        }
      } else {
        this.logger.warn(`[BrowserService] Стратегію логіну '${url}' не знайдено!`);
      }
    }

    this.logger.log(`[BrowserService] Context для ${sessionId} успішно створено.`);
    return context;
  }

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

    const safeForbiddenRoutes = (session.config.forbiddenRoutes || [])
      .map(r => r.trim())
      .filter(r => r.length > 0 && r !== '/');

    if (safeForbiddenRoutes.length > 0) {
      // Функція нормалізації для Playwright (Node.js середовище)
      const normalizeUrlNode = (u: string) => {
        try {
          const parsed = new URL(u);
          return (parsed.hostname + parsed.pathname).replace(/\/+$/, '');
        } catch (e) {
          return u.replace(/\/+$/, '');
        }
      };

      const normalizedForbiddenRoutes = safeForbiddenRoutes.map(normalizeUrlNode);

      page.on('framenavigated', async (frame) => {
        if (frame === page.mainFrame()) {
          const currentUrl = frame.url();
          const currentNorm = normalizeUrlNode(currentUrl);

          const isForbidden = normalizedForbiddenRoutes.some(fr => currentNorm.includes(fr));

          if (isForbidden) {
            this.logger.warn(`[BrowserService] Відловлено заборонений роут: ${currentUrl}. Відкат.`);
            try {
              // Відкочуємо сторінку назад або повертаємо на стартову
              const response = await page.goBack({ waitUntil: 'domcontentloaded' });
              if (!response) {
                await page.goto(session.config.url);
              }
            } catch (e) {
              await page.goto(session.config.url);
            }
          }
        }
      });
    }

    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      maxWidth: session.config.viewport.width,
      maxHeight: session.config.viewport.height,
    });

    let lastFrameBuffer: Buffer | null = null;
    const clientKey = `${sessionId}_${clientId}`;

    cdpSession.on('Page.screencastFrame', async (frameObject) => {
      await cdpSession.send('Page.screencastFrameAck', { sessionId: frameObject.sessionId }).catch(() => { });
      lastFrameBuffer = Buffer.from(frameObject.data, 'base64');
    });

    const interval = setInterval(() => {
      if (lastFrameBuffer) {
        onFrame(lastFrameBuffer);
      }
    }, 1000 / 30);

    this.frameIntervals.set(clientKey, interval);

    this.logger.log(`[BrowserService] Вкладку для клієнта ${clientId} створено. Насос кадрів запущено.`);
    return page;
  }

  async removePageForClient(sessionId: string, clientId: string) {
    const clientKey = `${sessionId}_${clientId}`;

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

  async interact(sessionId: string, clientId: string, action: any) {
    // Вкладка вже правильно шукається для конкретного клієнта
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
      this.logger.debug(`[Browser] Помилка дії: ${(e as Error).message}`);
    }
  }
}