import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BrowserContext, chromium, Page, Request } from 'playwright';
import UserAgent from 'user-agents';
import { AuthStrategyRegistry } from './auth/auth.registry';
import { buildPageScript, ClientRules, EMPTY_RULES, navigationBlockReason } from './rules/page-rules';
import { LogSeverity, NotificationEventType, SessionEventType } from './types';

// Параметри трансляції (ТЗ 7.6): частота кадрів, якість JPEG-кадрів, бітрейт відео.
export interface StreamSettings {
  fps: number;
  quality: number;
  bitrateKbps: number;
}

export interface ProxySettings {
  server: string;
  username?: string;
  password?: string;
}

interface ActiveSession {
  context: BrowserContext;
  url: string;
  viewport: { width: number; height: number };
  authData: { email: string; password: string };
  stream: StreamSettings;
  userDataDir: string;
  loginStarted: boolean;
  // Поки триває автологін, дії на сторінці не журналюються (логін акаунта - секрет для GA/User).
  loginInProgress: boolean;
  stopping: boolean;
}

interface ClientPage {
  page: Page;
  userId: string;
  rules: ClientRules;
  frameTimer?: NodeJS.Timeout;
  lastActivityReport: number;
}

// Як часто воркер повідомляє API про активність користувача (для таймауту бездіяльності).
const ACTIVITY_REPORT_MS = 15_000;

export const DEFAULT_STREAM: StreamSettings = {
  fps: Number(process.env.STREAM_FPS) || 15,
  quality: Number(process.env.STREAM_JPEG_QUALITY) || 90,
  bitrateKbps: Number(process.env.STREAM_BITRATE_KBPS) || 4000,
};

const REPORT_TYPES: Record<string, { eventType: SessionEventType; severity: LogSeverity; incident: boolean; label: string }> = {
  click: { eventType: SessionEventType.ButtonClick, severity: LogSeverity.Info, incident: false, label: 'Натиск' },
  input: { eventType: SessionEventType.TextInput, severity: LogSeverity.Info, incident: false, label: 'Введення тексту' },
  forbidden_element: { eventType: SessionEventType.ForbiddenAction, severity: LogSeverity.Critical, incident: true, label: 'Заборонений елемент заблоковано' },
  forbidden_link: { eventType: SessionEventType.ForbiddenAction, severity: LogSeverity.Critical, incident: true, label: 'Заборонений перехід заблоковано' },
};

@Injectable()
export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);
  private sessions = new Map<string, ActiveSession>();
  private pages = new Map<string, ClientPage>();
  private actionQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly authRegistry: AuthStrategyRegistry,
    @Inject('API_CLIENT') private apiClient: ClientProxy,
  ) { }

  private key(sessionId: string, clientId: string) {
    return `${sessionId}_${clientId}`;
  }

  private log(sessionId: string, userId: string | undefined, eventType: SessionEventType, message: string, severity = LogSeverity.Info, isIncident = false) {
    this.apiClient.emit('session.log.event', { sessionId, userId, eventType, severity, message, isIncident });
  }

  // Критичні помилки воркера - системне сповіщення Super Admin (ТЗ 15), не користувачу.
  private notifyWorkerError(subject: string, body: string) {
    this.apiClient.emit('notification.send', {
      typeName: NotificationEventType.WORKER_ERROR,
      content: { subject, body },
    });
  }

  private failSession(sessionId: string, message: string) {
    this.apiClient.emit('session.failed', { sessionId, message });
  }

  private reportActivity(sessionId: string, client: ClientPage) {
    const now = Date.now();
    if (now - client.lastActivityReport < ACTIVITY_REPORT_MS) return;
    client.lastActivityReport = now;
    this.apiClient.emit('session.activity', { sessionId, userId: client.userId });
  }

  // ---------- Сесія (браузерний контекст) ----------

  async launchSession(
    sessionId: string,
    url: string,
    viewport: { width: number; height: number },
    authData: { email: string; password: string },
    stream: StreamSettings = DEFAULT_STREAM,
    proxy?: ProxySettings,
  ) {
    if (this.sessions.has(sessionId)) return;
    const userDataDir = path.join(os.tmpdir(), 'playwright_sessions', sessionId);

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        viewport,
        userAgent: new UserAgent().toString(),
        ignoreHTTPSErrors: true,
        proxy,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Не вдалось запустити браузер для сесії ${sessionId}: ${message}`);
      this.notifyWorkerError('Помилка запуску браузера', `Не вдалось запустити сесію ${sessionId}: ${message}`);
      this.failSession(sessionId, 'не вдалося запустити браузер');
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
      return;
    }

    const session: ActiveSession = {
      context,
      url,
      viewport,
      authData,
      stream,
      userDataDir,
      loginStarted: false,
      loginInProgress: false,
      stopping: false,
    };
    this.sessions.set(sessionId, session);

    // Браузер закрився не з нашої команди - збій: сесія отримує статус «помилка», інші сесії не зачіпаються.
    context.on('close', () => {
      if (session.stopping) return;
      this.logger.error(`Браузер сесії ${sessionId} несподівано закрився`);
      this.notifyWorkerError('Збій браузера', `Браузер сесії ${sessionId} несподівано закрився`);
      this.cleanupSession(sessionId).catch(() => undefined);
      this.failSession(sessionId, 'браузер несподівано закрився');
    });

    // Сайт відкрив нове вікно (popup, форма з target=_blank): відкриваємо адресу в тій вкладці
    // користувача, з якої його відкрито, - інші користувачі сесії цього не бачать.
    context.on('page', async (popup) => {
      const opener = await popup.opener().catch(() => null);
      if (!opener) return;
      const owner = [...this.pages.values()].find((c) => c.page === opener);
      await popup.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined);
      const target = popup.url();
      await popup.close().catch(() => undefined);
      if (owner && target && target !== 'about:blank') {
        await owner.page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      }
    });

    if (!this.authRegistry.get(url)) {
      this.log(sessionId, undefined, SessionEventType.SessionError, `Стратегію автологіну для '${url}' не знайдено`, LogSeverity.Warning);
    }
    this.log(sessionId, undefined, SessionEventType.Other, 'Браузер сесії запущено');
  }

  private async cleanupSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    for (const [key, client] of this.pages) {
      if (!key.startsWith(`${sessionId}_`)) continue;
      if (client.frameTimer) clearInterval(client.frameTimer);
      this.pages.delete(key);
    }
    // Профіль браузера сесії більше не потрібен.
    await fs.rm(session.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.stopping = true;
    try {
      await session.context.close();
    } catch (error) {
      this.logger.error(`Помилка закриття браузера сесії ${sessionId}`, error as Error);
    } finally {
      await this.cleanupSession(sessionId);
    }
  }

  streamSettings(sessionId: string): StreamSettings {
    return this.sessions.get(sessionId)?.stream ?? DEFAULT_STREAM;
  }

  // ---------- Вкладка користувача (сторінка) ----------

  async addClientPage(
    userId: string,
    sessionId: string,
    clientId: string,
    rules: ClientRules = EMPTY_RULES,
    onFrame: (buffer: Buffer) => void,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Браузер сесії не запущено');

    const key = this.key(sessionId, clientId);
    await this.removePageForClient(sessionId, clientId);

    const page = await session.context.newPage();
    const client: ClientPage = { page, userId, rules, lastActivityReport: 0 };
    this.pages.set(key, client);

    try {
      // Дії на сторінці (натискання, введення, заборонені дії) - у журнал із правильними тегами (ТЗ 9).
      await page.exposeFunction('__pwReport', (kind: string, details: string, currentUrl: string) => {
        const type = REPORT_TYPES[kind];
        if (!type || session.loginInProgress) return;
        this.log(sessionId, userId, type.eventType, `${type.label}: ${details} (сторінка: ${currentUrl})`, type.severity, type.incident);
        this.reportActivity(sessionId, client);
      });
      await page.addInitScript({ content: buildPageScript(rules, session.url) });

      // Заборонені переходи на рівні мережі (повне завантаження сторінки, редирект, форма).
      await page.route('**/*', (route) => {
        const request: Request = route.request();
        // Під час автологіну сайт може водити сторінками входу - список дозволених не застосовується.
        const reason = request.isNavigationRequest() && request.frame() === page.mainFrame()
          ? navigationBlockReason(request.url(), client.rules, session.url)
          : null;
        if (reason && !(session.loginInProgress && reason !== 'заборонений перехід')) {
          this.log(sessionId, userId, SessionEventType.ForbiddenAction, `Перехід заблоковано (${reason}): ${request.url()}`, LogSeverity.Critical, true);
          return route.abort('blockedbyclient').catch(() => undefined);
        }
        return route.continue().catch(() => undefined);
      });

      // Кожен перехід сторінкою - у журнал (ТЗ 9).
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        const current = frame.url();
        if (!current || current === 'about:blank' || session.loginInProgress) return;
        this.log(sessionId, userId, SessionEventType.Navigation, `Перехід: ${current}`);
      });

      await page.goto(session.url, { waitUntil: 'domcontentloaded' });

      const cdp = await page.context().newCDPSession(page);
      let lastFrame: Buffer | null = null;
      cdp.on('Page.screencastFrame', (frame) => {
        cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
        lastFrame = Buffer.from(frame.data, 'base64');
      });
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: session.stream.quality,
        maxWidth: session.viewport.width,
        maxHeight: session.viewport.height,
      });
      // Кадри з постійною частотою: екран без змін не «мерехтить» і не зависає.
      client.frameTimer = setInterval(() => {
        if (lastFrame) onFrame(lastFrame);
      }, 1000 / session.stream.fps);

      this.log(sessionId, userId, SessionEventType.Other, `Вкладку користувача ${userId} відкрито`);

      // Автологін - один раз на сесію, на першій вкладці; далі всі вкладки мають спільні cookie.
      const strategy = this.authRegistry.get(session.url);
      if (strategy && !session.loginStarted) {
        session.loginStarted = true;
        session.loginInProgress = true;
        strategy
          .login(page, session.authData)
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.log(sessionId, userId, SessionEventType.SessionError, `Помилка автологіну: ${message}`, LogSeverity.Warning);
          })
          .finally(() => {
            session.loginInProgress = false;
            this.log(sessionId, userId, SessionEventType.Other, 'Автологін завершено');
          });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Помилка відкриття вкладки ${key}: ${message}`);
      await this.removePageForClient(sessionId, clientId);
      this.log(sessionId, userId, SessionEventType.SessionError, `Помилка відкриття вкладки: ${message}`, LogSeverity.Critical, true);
      throw error;
    }
  }

  async removePageForClient(sessionId: string, clientId: string) {
    const key = this.key(sessionId, clientId);
    const client = this.pages.get(key);
    if (!client) return;
    this.pages.delete(key);
    if (client.frameTimer) clearInterval(client.frameTimer);
    await client.page.close().catch(() => undefined);
  }

  // ---------- Дії користувача ----------

  async interact(sessionId: string, clientId: string, action: any) {
    const key = this.key(sessionId, clientId);
    const client = this.pages.get(key);
    if (!client) return;
    const { page } = client;

    if (action.type === 'mousemove') {
      await page.mouse.move(action.x, action.y).catch(() => undefined);
      return;
    }
    if (action.type === 'wheel') {
      await page.mouse.wheel(action.deltaX, action.deltaY).catch(() => undefined);
      this.reportActivity(sessionId, client);
      return;
    }

    const previous = this.actionQueues.get(key) || Promise.resolve();
    const current = previous.then(async () => {
      try {
        switch (action.type) {
          case 'mousedown':
          case 'mouseup':
            // Лише ліва кнопка: права кнопка в трансляції заблокована повністю (ТЗ 7.1).
            if (action.button !== undefined && action.button !== 0) return;
            if (action.x !== undefined && action.y !== undefined) await page.mouse.move(action.x, action.y);
            await (action.type === 'mousedown' ? page.mouse.down() : page.mouse.up());
            break;
          case 'keydown':
            await page.keyboard.down(action.key);
            break;
          case 'keyup':
            await page.keyboard.up(action.key);
            break;
          case 'text':
            if (typeof action.text === 'string' && action.text.length <= 5000) await page.keyboard.insertText(action.text);
            break;
          case 'navigate_back':
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => undefined);
            break;
          case 'navigate_forward':
            await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => undefined);
            break;
          default:
            return;
        }
        this.reportActivity(sessionId, client);
      } catch (e) {
        this.logger.debug(`Помилка дії ${action.type} у ${key}: ${(e as Error).message}`);
      }
    });

    this.actionQueues.set(key, current);
    current.finally(() => {
      if (this.actionQueues.get(key) === current) this.actionQueues.delete(key);
    });
  }
}
