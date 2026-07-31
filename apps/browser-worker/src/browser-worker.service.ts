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
          try {
            if (!page.isClosed()) await page.close();
          } catch (e) {
            this.logger.debug(`[BrowserService] Помилка закриття вкладки клієнта ${clientId} при зупинці сесії ${sessionId}: ${e}`);
          }
          const clientKey = `${sessionId}_${clientId}`;
          const interval = this.frameIntervals.get(clientKey);
          if (interval) {
            clearInterval(interval);
            this.frameIntervals.delete(clientKey);
          }
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

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
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
    } catch (error) {
      this.logger.error(`[BrowserService] Не вдалось запустити браузер для сесії ${sessionId}:`, error);
      this.apiClient.emit('notification.send', {
        userId,
        typeName: NotificationEventType.WORKER_ERROR,
        content: {
          subject: `[BrowserService] Помилка запуску браузера`,
          body: `Не вдалось запустити сесію ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        },
        sendEmail: true,
      });
      this.apiClient.emit('session.log.event', {
        sessionId, userId,
        eventType: SessionEventType.SessionError,
        severity: LogSeverity.Critical,
        message: `[BrowserService] Не вдалось запустити браузер: ${error instanceof Error ? error.message : String(error)}`,
        isIncident: true,
      });
      throw error;
    }
    context.on('page', async (newPage) => {
      try {
        const opener = await newPage.opener();
        if (!opener) return;

        await newPage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        const targetUrl = newPage.url();
        await newPage.close();

        const clientPages = this.activePages.get(sessionId);
        if (clientPages) {
          for (const page of clientPages.values()) {
            if (!page.isClosed()) {
              await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
            }
          }
        }
      } catch (e) {
        this.logger.error(`[BrowserService] Помилка обробки popup-вкладки: ${e}`);
      }
    });
    // --- 1. ПРАВИЛА МАРШРУТИЗАЦІЇ (РОУТИ) ---

    // 👇 ДОДАНО: Очищаємо масив від небезпечних значень (порожніх рядків та просто '/')
    this.logger.warn("forbiddenRoutes: ", forbiddenRoutes)
    const safeForbiddenRoutes = (forbiddenRoutes || [])
      .map(r => r.trim())
      .filter(r => r.length > 0 && r !== '/');

    // (А) Блокування на рівні мережі (для повних перезавантажень сторінки)
    await context.route('**/*', (route) => {
      try {
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
            return route.abort('accessdenied').catch(() => { });
          }
        }
        route.continue().catch(() => { }); 
      } catch (e) {
        this.logger.debug(`[BrowserService] Помилка обробки маршруту: ${e}`);
        route.continue().catch(() => { });
      }
    });
    this.logger.warn("safeForbiddenRoutes: ", safeForbiddenRoutes)
    if (safeForbiddenRoutes.length > 0) {
      await context.addInitScript((routes: string[]) => {
        const normalizeUrl = (u: string) => {
          if (!u) return '';
          try {
            const parsed = new URL(u, window.location.origin);
            return (parsed.hostname + parsed.pathname).replace(/\/+$/, '');
          } catch (e) {
            return u.replace(/\/+$/, ''); 
          }
        };

        const normalizedRoutes = routes.map(normalizeUrl);

        const isForbiddenUrl = (targetUrl: string) => {
          if (!targetUrl) return false;
          const targetNorm = normalizeUrl(targetUrl);
          return normalizedRoutes.some(r => targetNorm.includes(r));
        };

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
      await context.addInitScript(() => {
        window.addEventListener('click', (e) => {
          const link = (e.target as HTMLElement).closest('a[target="_blank"]');
          if (link) link.removeAttribute('target');
        }, true);
      });
    }
    if (forbiddenSelectors && forbiddenSelectors.length > 0) {
      await context.addInitScript((selectors: string[]) => {
        const blockEvent = (e: Event) => {
          const target = e.target as HTMLElement;
          if (!target) return;

          try {
            const isForbidden = selectors.some(sel => target.matches(sel) || target.closest(sel));
            if (isForbidden) {
              e.stopPropagation(); 
              e.preventDefault();  
            }
          } catch (err) {}
        };

        window.addEventListener('mousedown', blockEvent, true);
        window.addEventListener('mouseup', blockEvent, true);
        window.addEventListener('click', blockEvent, true);
        window.addEventListener('keydown', blockEvent, true);
        window.addEventListener('keyup', blockEvent, true);

        window.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = selectors.map(s => `${s} { opacity: 0.6 !important; cursor: not-allowed !important; pointer-events: none !important; }`).join('\n');
          document.head.appendChild(style);
        });
      }, forbiddenSelectors);
    }

    this.sessions.set(sessionId, {
      context,
      config: { url, viewport, allowedRoutes, forbiddenSelectors, forbiddenRoutes, authData }
    });

    if (url) {
      const strategy = this.authRegistry.get(url);
      if (strategy) {
        this.logger.log(`[BrowserService] Стратегію логіну для ${url} знайдено. Виконається після підключення клієнта.`);
      } else {
        this.apiClient.emit('notification.send', {
          userId, typeName: NotificationEventType.WORKER_ERROR,
          content: { subject: `[BrowserService] Стратегія логіну`, body: `Стратегію логіну '${url}' не знайдено!` },
          sendEmail: false,
        });
        this.apiClient.emit('session.log.event', {
          sessionId, userId, eventType: SessionEventType.SessionError,
          severity: LogSeverity.Warning, message: `Стратегію логіну '${url}' не знайдено!`, isIncident: false,
        });
      }
    }

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

    let page: Page;
    try {
      page = await session.context.newPage();
    } catch (error) {
      this.logger.error(`[BrowserService] Не вдалось створити вкладку для клієнта ${clientId}:`, error);
      throw error;
    }

    try {
      await page.exposeFunction('logActionToNode', (actionType: string, details: string, currentUrl: string) => {
      const urlLabel = currentUrl || 'невідома сторінка';
      const fullMessage = `Користувач ${userId} -> ${actionType} -> ${details} (сторінка: ${urlLabel})`;

      this.apiClient.emit('session.log.event', {
        sessionId,
        userId,
        eventType: SessionEventType.Other,
        severity: LogSeverity.Info,
        message: fullMessage,
        isIncident: false
      });
      this.logger.debug(
        `[User Action] user=${userId} session=${sessionId} action="${actionType}" url="${urlLabel}" target="${details}"`
      );
    });

    await page.addInitScript(() => {
      const getElementDescription = (el: HTMLElement): string => {
        if (!el) return 'невідомий об\'єкт';

        const tagName = el.tagName.toLowerCase();

        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return `<${tagName}> [aria-label="${ariaLabel}"]`;

        const title = el.getAttribute('title');
        if (title) return `<${tagName}> [title="${title}"]`;

        const id = el.id;
        if (id) return `<${tagName}> [id="${id}"]`;

        const name = el.getAttribute('name');
        if (name) return `<${tagName}> [name="${name}"]`;

        const placeholder = el.getAttribute('placeholder');
        if (placeholder) return `<${tagName}> [placeholder="${placeholder}"]`;

        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 0) {
          return `<${tagName}> з текстом "${text.substring(0, 60)}"`;
        }

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

        const className = (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 2).join('.');
        const classStr = className ? `.${className}` : '';

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

      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (!target) return;

        const interactiveEl = target.closest('button, a, input, select, textarea, [role="button"], [tabindex]') || target;

        const description = getElementDescription(interactiveEl as HTMLElement);
        const currentUrl = window.location.href;

        (window as any).logActionToNode('Клік', description, currentUrl);
      }, true);

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
    if (!this.activePages.has(sessionId)) {
      this.activePages.set(sessionId, new Map());
    }
    this.activePages.get(sessionId)!.set(clientId, page);

    try {
      await page.goto(session.config.url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      this.logger.error(`[BrowserService] Не вдалось відкрити ${session.config.url} для клієнта ${clientId}:`, error);
      throw error;
    }

    const safeForbiddenRoutes = (session.config.forbiddenRoutes || [])
      .map(r => r.trim())
      .filter(r => r.length > 0 && r !== '/');

    if (safeForbiddenRoutes.length > 0) {
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

    let cdpSession;
    try {
      cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 90,
        maxWidth: session.config.viewport.width,
        maxHeight: session.config.viewport.height,
      });
    } catch (error) {
      this.logger.error(`[BrowserService] Не вдалось запустити CDP screencast для клієнта ${clientId}:`, error);
      throw error;
    }

    let lastFrameBuffer: Buffer | null = null;
    const clientKey = `${sessionId}_${clientId}`;

    cdpSession.on('Page.screencastFrame', (frameObject) => {
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
    if (strategy && !session.interactiveLoginStarted) {
      session.interactiveLoginStarted = true;

      strategy.login(page, session.config.authData).catch(error => {
        this.logger.error(`[BrowserService] Помилка автологіну: ${error}`);
        this.apiClient.emit('session.log.event', {
          sessionId, userId,
          eventType: SessionEventType.SessionError,
          severity: LogSeverity.Warning,
          message: `[BrowserService] Помилка автологіну: ${error instanceof Error ? error.message : String(error)}`,
          isIncident: false
        });
      });
    }
    this.apiClient.emit('session.log.event', {
      sessionId,
      userId: userId,
      eventType: SessionEventType.Other,
      severity: LogSeverity.Warning,
      message: `[BrowserService] Вкладку для користувача ${userId} створено.`,
      isIncident: false
    });
    return page;
    } catch (error) {
      this.logger.error(`[BrowserService] Помилка налаштування вкладки для клієнта ${clientId}:`, error);

      const clientKeyOnFail = `${sessionId}_${clientId}`;
      const intervalOnFail = this.frameIntervals.get(clientKeyOnFail);
      if (intervalOnFail) {
        clearInterval(intervalOnFail);
        this.frameIntervals.delete(clientKeyOnFail);
      }

      this.activePages.get(sessionId)?.delete(clientId);

      if (!page.isClosed()) {
        await page.close().catch(() => { });
      }

      this.apiClient.emit('session.log.event', {
        sessionId, userId,
        eventType: SessionEventType.SessionError,
        severity: LogSeverity.Critical,
        message: `[BrowserService] Помилка налаштування вкладки: ${error instanceof Error ? error.message : String(error)}`,
        isIncident: true,
      });

      throw error;
    }
  }

  async removePageForClient(sessionId: string, clientId: string) {
    const clientKey = `${sessionId}_${clientId}`;

    const interval = this.frameIntervals.get(clientKey);
    if (interval) {
      clearInterval(interval);
      this.frameIntervals.delete(clientKey);
    }

    const page = this.activePages.get(sessionId)?.get(clientId);
    if (page) {
      try {
        if (!page.isClosed()) {
          await page.close();
        }
      } catch (e) {
        this.logger.debug(`[BrowserService] Помилка закриття вкладки ${clientKey}: ${e}`);
      } finally {
        this.activePages.get(sessionId)?.delete(clientId);
      }
    }
  }

  async interact(sessionId: string, clientId: string, userId: string, action: any) {
    const page = this.activePages.get(sessionId)?.get(clientId);
    if (!page) return;

    const clientKey = `${sessionId}_${clientId}`;
    if (action.type === 'mousemove' || action.type === 'wheel') {
      try {
        if (action.type === 'mousemove') {
          await page.mouse.move(action.x, action.y);
        } else if (action.type === 'wheel') {
          await page.mouse.wheel(action.deltaX, action.deltaY);
        }
      } catch (e) {
        this.logger.debug(`[Browser] Помилка миттєвої дії: ${(e as Error).message}`);
      }
      return;
    }

    const previousAction = this.actionQueues.get(clientKey) || Promise.resolve();

    const currentAction = previousAction.then(async () => {
      try {
        switch (action.type) {
          case 'mousedown': {
            const downBtn = action.button === 2 ? 'right' : action.button === 1 ? 'middle' : 'left';

            if (action.x !== undefined && action.y !== undefined) {
              await page.mouse.move(action.x, action.y);
            }
            await page.mouse.down({ button: downBtn });

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
          case 'navigate_back': {
            try {
              const response = await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
              if (!response) {
                this.logger.debug(`[Browser] goBack: історія навігації порожня для ${clientKey}`);
              }
            } catch (e) {
              this.logger.debug(`[Browser] Помилка goBack для ${clientKey}: ${(e as Error).message}`);
            }
            break;
          }
          case 'navigate_forward': {
            try {
              await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 });
            } catch (e) {
              this.logger.debug(`[Browser] Помилка goForward для ${clientKey}: ${(e as Error).message}`);
            }
            break;
          }
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