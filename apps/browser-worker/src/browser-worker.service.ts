// apps/browser-worker/src/browser/browser.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import * as path from 'path';
import { BrowserContext, chromium, Page } from 'playwright';
import UserAgent from 'user-agents';
import { AuthStrategyRegistry } from './auth/auth.registry';
import { LogSeverity, NotificationEventType, SessionEventType } from './types';

interface SessionConfig {
  url: string;
  viewport: { width: number; height: number };
  allowedRoutes: string[];
  forbiddenSelectors: string[];
  forbiddenRoutes: string[];
  authData: { email: string; password: string };
}

interface ActiveSession {
  context: BrowserContext;
  config: SessionConfig;
  interactiveLoginStarted?: boolean;
}

@Injectable()
export class BrowserService {
  constructor(private readonly authRegistry: AuthStrategyRegistry, @Inject('API_CLIENT') private apiClient: ClientProxy) { }

  private readonly logger = new Logger(BrowserService.name);
  private actionQueues = new Map<string, Promise<void>>();

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
    userId: string,
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
          this.apiClient.emit('notification.send', {
            userId: userId,
            typeName: NotificationEventType.WORKER_ERROR,
            content: {
              subject: `[Browser] Блокування переходу`,
              body: `[Browser] Блокування переходу (заборонений роут): ${reqUrl}`,
            },
            sendEmail: true,
          });
          this.apiClient.emit('session.log.event', {
            sessionId,
            userId,
            eventType: SessionEventType.ForbiddenAction,
            severity: LogSeverity.Critical,
            message: `[Browser] Блокування переходу (заборонений роут): ${reqUrl}`,
            isIncident: true
          });
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
              this.apiClient.emit('notification.send', {
                userId: userId,
                typeName: NotificationEventType.WORKER_ERROR,
                content: {
                  subject: `[Browser] Блокування переходу`,
                  body: `[Browser] Блокування переходу (заборонений роут): ${link.href}`,
                },
                sendEmail: true,
              });
              this.apiClient.emit('session.log.event', {
                sessionId,
                userId,
                eventType: SessionEventType.ForbiddenAction,
                severity: LogSeverity.Critical,
                message: `[Browser] Блокування переходу (заборонений роут): ${link.href}`,
                isIncident: true
              });
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
      config: { url, viewport, allowedRoutes, forbiddenSelectors, forbiddenRoutes, authData }
    });

    // Логіка автологіну
    if (url) {
      const strategy = this.authRegistry.get(url);
      if (strategy) {
        if (strategy.isInteractive) {
          this.logger.log(`[BrowserService] Логін для ${url} є інтерактивним. Відкладаємо до підключення клієнта.`);
        } else {
          this.apiClient.emit('notification.send', {
            userId: userId,
            typeName: NotificationEventType.SESSION_STARTED,
            content: {
              subject: `[BrowserService] Запуск автологіну`,
              body: `[BrowserService] Запуск автологіну через: ${strategy.url}`,
            },
            sendEmail: false,
          });
          this.apiClient.emit('session.log.event', {
            sessionId,
            userId: userId,
            eventType: SessionEventType.Other,
            severity: LogSeverity.Info,
            message: `[BrowserService] Запуск автологіну через: ${strategy.url}`,
            isIncident: false
          });
          const loginPage = await context.newPage();
          try {
            await strategy.login(loginPage, authData);
          } catch (error) {
            this.apiClient.emit('notification.send', {
              userId: userId,
              typeName: NotificationEventType.WORKER_ERROR,
              content: {
                subject: `[BrowserService] Помилка автологіну`,
                body: `[BrowserService] Помилка автологіну: ${error instanceof Error ? error.message : String(error)}`,
              },
              sendEmail: false,
            });
            this.apiClient.emit('session.log.event', {
              sessionId,
              userId,
              eventType: SessionEventType.SessionError,
              severity: LogSeverity.Warning,
              message: `[BrowserService] Помилка автологіну: ${error instanceof Error ? error.message : String(error)}`,
              isIncident: false
            });
          } finally {
            await loginPage.close();
          }
        }
      } else {
        this.apiClient.emit('notification.send', {
          userId: userId,
          typeName: NotificationEventType.WORKER_ERROR,
          content: {
            subject: `[BrowserService] Стратегія логіну`,
            body: `[BrowserService] Стратегію логіну '${url}' не знайдено!`,
          },
          sendEmail: false,
        });
        this.apiClient.emit('session.log.event', {
          sessionId,
          userId,
          eventType: SessionEventType.SessionError,
          severity: LogSeverity.Warning,
          message: `[BrowserService] Стратегію логіну '${url}' не знайдено!`,
          isIncident: false
        });
      }
    }

    this.apiClient.emit('notification.send', {
      userId: userId,
      typeName: NotificationEventType.SESSION_STARTED,
      content: {
        subject: `[BrowserService] Context успішно створено.`,
        body: `[BrowserService] Context для сесії з id: ${sessionId} успішно створено.`,
      },
      sendEmail: false,
    });
    this.apiClient.emit('session.log.event', {
      sessionId,
      userId: userId,
      eventType: SessionEventType.Other,
      severity: LogSeverity.Info,
      message: `[BrowserService] Context для сесії з id: ${sessionId} успішно створено.`,
      isIncident: false
    });
    return context;
  }

  async addClientPage(
    userId,
    sessionId: string,
    clientId: string,
    onFrame: (buffer: Buffer) => void
  ): Promise<Page | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const page = await session.context.newPage();

    await page.exposeFunction('logActionToNode', (actionType: string, details: string, currentUrl: string) => {
      const fullMessage = `[Browser Action] ${actionType} на сторінці [${currentUrl}]: ${details}`;

      this.apiClient.emit('session.log.event', {
        sessionId,
        userId,
        eventType: SessionEventType.Other,
        severity: LogSeverity.Info,
        message: fullMessage,
        isIncident: false
      });
      this.logger.debug(`[User Action] ${actionType} (${currentUrl}) -> ${details}`);
    });

    // 👇 2. Впроваджуємо вдосконалений скрипт аналізу елементів
    await page.addInitScript(() => {
      // Універсальна функція для отримання зрозумілого опису будь-якого елемента
      const getElementDescription = (el: HTMLElement): string => {
        if (!el) return 'невідомий об\'єкт';

        const tagName = el.tagName.toLowerCase();

        // 1. Перевіряємо явні атрибути доступності (найвищий пріоритет)
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return `<${tagName}> [aria-label="${ariaLabel}"]`;

        const title = el.getAttribute('title');
        if (title) return `<${tagName}> [title="${title}"]`;

        // 2. Перевіряємо ідентифікатори форми
        const id = el.id;
        if (id) return `<${tagName}> [id="${id}"]`;

        const name = el.getAttribute('name');
        if (name) return `<${tagName}> [name="${name}"]`;

        const placeholder = el.getAttribute('placeholder');
        if (placeholder) return `<${tagName}> [placeholder="${placeholder}"]`;

        // 3. Перевіряємо текст (використовуємо innerText, щоб ігнорувати прихований текст, або textContent)
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 0) {
          return `<${tagName}> з текстом "${text.substring(0, 60)}"`;
        }

        // 4. Якщо це кнопка-іконка (без тексту), шукаємо картинку або SVG всередині
        const img = el.querySelector('img');
        if (img && img.getAttribute('alt')) {
          return `<${tagName}> із зображенням [alt="${img.getAttribute('alt')}"]`;
        }

        const svg = el.querySelector('svg');
        if (svg) {
          const svgClass = svg.getAttribute('class') || '';
          const dataIcon = svg.getAttribute('data-icon') || svgClass.split(/\s+/)[0];
          if (dataIcon) return `<${tagName}> з іконкою [${dataIcon}]`;
        }

        // 5. ФОЛБЕК: Якщо немає ні тексту, ні ID, будуємо читабельний CSS-контекст
        // Безпечно отримуємо класи (оскільки у SVG className - це об'єкт, використовуємо getAttribute)
        const className = (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 2).join('.');
        const classStr = className ? `.${className}` : '';

        // Додаємо інформацію про батьківський елемент, щоб зрозуміти, в якому блоці клікнули
        const parent = el.parentElement;
        if (parent) {
          const parentTag = parent.tagName.toLowerCase();
          const parentId = parent.id ? `#${parent.id}` : '';
          const parentClass = (parent.getAttribute('class') || '').trim().split(/\s+/)[0];
          const parentClassStr = parentClass ? `.${parentClass}` : '';

          return `елемент <${tagName}${classStr}> (без тексту) всередині блоку <${parentTag}${parentId}${parentClassStr}>`;
        }

        return `<${tagName}${classStr}> (без ідентифікаторів)`;
      };

      // Логування кліків
      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (!target) return;

        // Шукаємо найближчий інтерактивний елемент
        const interactiveEl = target.closest('button, a, input, select, textarea, [role="button"], [tabindex]') || target;

        const description = getElementDescription(interactiveEl as HTMLElement);
        const currentUrl = window.location.href;

        // Відправляємо детальний лог разом з URL
        (window as any).logActionToNode('Клік', description, currentUrl);
      }, true);

      // Логування вводу тексту
      document.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (!target) return;

        const tagName = target.tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(tagName)) {
          const isPassword = target.type === 'password';
          const value = isPassword ? '********' : target.value;

          const description = getElementDescription(target);
          const currentUrl = window.location.href;

          (window as any).logActionToNode(
            'Ввід даних',
            `Поле ${description} змінило значення на: "${value}"`,
            currentUrl
          );
        }
      }, true);
    });
    await page.addInitScript(() => {
      // Логування кліків
      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (!target) return;

        // Шукаємо найближчий інтерактивний елемент (щоб не логувати кліки по порожніх div)
        const interactiveEl = target.closest('button, a, input, select, textarea, [role="button"], [tabindex]') || target;

        // Спроба отримати зрозумілу назву елемента
        let name = interactiveEl.textContent || (interactiveEl as HTMLInputElement).value || interactiveEl.getAttribute('aria-label') || interactiveEl.id || interactiveEl.className || '';
        name = name.replace(/\s+/g, ' ').trim().substring(0, 50); // Обрізаємо довгий текст

        const tagName = interactiveEl.tagName.toLowerCase();

        // Логуємо тільки якщо клік був по чомусь осмисленому
        if (name) {
          (window as any).logActionToNode('Клік', `Елемент <${tagName}> з текстом/id "${name}"`);
        } else {
          (window as any).logActionToNode('Клік', `Невідомий елемент <${tagName}>`);
        }
      }, true); // true - фаза capture (перехоплюємо раніше за сам сайт)

      // Логування вводу тексту (спрацьовує при втраті фокусу або натисканні Enter)
      document.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (!target) return;

        const tagName = target.tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(tagName)) {
          // ВАЖЛИВО: Маскуємо паролі!
          const isPassword = target.type === 'password';
          const value = isPassword ? '********' : target.value;
          this.logger.debug(target)
          const identifier = target.name || target.id || target.getAttribute('aria-label') || target.getAttribute('placeholder') || 'невідоме поле';

          (window as any).logActionToNode('Ввід даних', `Поле "${identifier}" змінило значення на: "${value}"`);
        }
      }, true);
    });
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

          this.apiClient.emit('session.log.event', {
            sessionId,
            userId,
            eventType: SessionEventType.Other,
            severity: LogSeverity.Info, 
            message: `[Browser] Перехід на сторінку: ${currentUrl}`,
            isIncident: false
          });
          const currentNorm = normalizeUrlNode(currentUrl);

          const isForbidden = normalizedForbiddenRoutes.some(fr => currentNorm.includes(fr));

          if (isForbidden) {
            this.apiClient.emit('notification.send', {
              userId: userId,
              typeName: NotificationEventType.WORKER_ERROR,
              content: {
                subject: `[BrowserService] Заборонений роут`,
                body: `[BrowserService] Відловлено заборонений роут: ${currentUrl}.`,
              },
              sendEmail: true,
            });
            this.apiClient.emit('session.log.event', {
              sessionId,
              userId,
              eventType: SessionEventType.ForbiddenAction,
              severity: LogSeverity.Critical,
              message: `[BrowserService] Відловлено заборонений роут: ${currentUrl}.`,
              isIncident: true
            });
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
      quality: 90,
      maxWidth: session.config.viewport.width,
      maxHeight: session.config.viewport.height,
    });

    let lastFrameBuffer: Buffer | null = null;
    const clientKey = `${sessionId}_${clientId}`;

    // НЕ робимо колбек async, щоб не блокувати потік
    cdpSession.on('Page.screencastFrame', (frameObject) => {
      // Відправляємо Ack у фоні (catch обов'язковий, бо сесія може вже закритися)
      cdpSession.send('Page.screencastFrameAck', { sessionId: frameObject.sessionId }).catch(() => { });
      lastFrameBuffer = Buffer.from(frameObject.data, 'base64');
    });

    const TARGET_FPS = 24;
    const interval = setInterval(() => {
      if (lastFrameBuffer) {
        onFrame(lastFrameBuffer);
      }
    }, 1000 / TARGET_FPS);
    this.frameIntervals.set(clientKey, interval);
    const strategy = this.authRegistry.get(session.config.url);
    if (strategy && strategy.isInteractive && !session.interactiveLoginStarted) {
      session.interactiveLoginStarted = true;

      strategy.login(page, session.config.authData).catch(error => {
        this.logger.error(`[BrowserService] Помилка інтерактивного логіну: ${error}`);
      });
    }
    this.apiClient.emit('notification.send', {
      userId: userId,
      typeName: NotificationEventType.SESSION_STARTED,
      content: {
        subject: `[BrowserService] Вкладку створено`,
        body: `[BrowserService] Вкладку для користувача ${userId} створено.`,
      },
      sendEmail: false,
    });
    this.apiClient.emit('session.log.event', {
      sessionId,
      userId: userId,
      eventType: SessionEventType.Other,
      severity: LogSeverity.Warning,
      message: `[BrowserService] Вкладку для користувача ${userId} створено.`,
      isIncident: false
    });
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

  async interact(sessionId: string, clientId: string, userId: string, action: any) {
    const page = this.activePages.get(sessionId)?.get(clientId);
    if (!page) return;

    const clientKey = `${sessionId}_${clientId}`;

    // 1. ДІЇ, ЩО НЕ ПОТРЕБУЮТЬ ЧЕРГИ (Рух та скрол виконуються миттєво)
    if (action.type === 'mousemove' || action.type === 'wheel') {
      try {
        if (action.type === 'mousemove') {
          // ПРИБРАНО { steps: 2 }, бо це дуже уповільнювало Playwright!
          await page.mouse.move(action.x, action.y);
        } else if (action.type === 'wheel') {
          await page.mouse.wheel(action.deltaX, action.deltaY);
        }
      } catch (e) {
        this.logger.debug(`[Browser] Помилка миттєвої дії: ${(e as Error).message}`);
      }
      return; // Виходимо, щоб ці дії не блокували чергу
    }

    // 2. ДІЇ, ЯКІ ПОТРЕБУЮТЬ СТРОГОЇ ЧЕРГИ (Кліки та клавіатура)
    const previousAction = this.actionQueues.get(clientKey) || Promise.resolve();

    const currentAction = previousAction.then(async () => {
      try {
        switch (action.type) {
          case 'mousedown': {
            const downBtn = action.button === 2 ? 'right' : action.button === 1 ? 'middle' : 'left';

            // ГАРАНТІЯ ТОЧНОСТІ: Примусово ставимо мишку туди, де був клік на фронті
            if (action.x !== undefined && action.y !== undefined) {
              await page.mouse.move(action.x, action.y);
            }
            await page.mouse.down({ button: downBtn });

            // Асинхронне логування
            // page.evaluate(({ x, y }) => {
            //   const el = document.elementFromPoint(x, y);
            //   if (!el) return 'порожнє місце';
            //   const target = el.closest('button, a, input, [role="button"]') || el;
            //   const text = (target.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 50);
            //   return text ? `<${target.tagName.toLowerCase()}> з текстом "${text}"` : 'елемент';
            // }, { x: action.x, y: action.y })
            //   .then((elementInfo) => {
            //     this.apiClient.emit('session.log.event', {
            //       sessionId,
            //       userId,
            //       eventType: SessionEventType.Other,
            //       severity: LogSeverity.Warning,
            //       message: `[Browser] Користувач ${userId} натиснув на елемент ${elementInfo}`,
            //       isIncident: true
            //     });
            //   }).catch(() => { });
            break;
          }
          case 'mouseup': {
            const upBtn = action.button === 2 ? 'right' : action.button === 1 ? 'middle' : 'left';

            if (action.x !== undefined && action.y !== undefined) {
              await page.mouse.move(action.x, action.y);
            }
            await page.mouse.up({ button: upBtn });
            break;
          }
          case 'keydown':
            await page.keyboard.down(action.key);
            break;
          case 'keyup':
            await page.keyboard.up(action.key);
            break;
        }
      } catch (e) {
        this.logger.debug(`[Browser] Помилка черги: ${(e as Error).message}`);
      }
    });

    this.actionQueues.set(clientKey, currentAction);
    currentAction.finally(() => {
      if (this.actionQueues.get(clientKey) === currentAction) {
        this.actionQueues.delete(clientKey);
      }
    });
  }
}