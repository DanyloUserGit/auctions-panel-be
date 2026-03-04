// apps/browser-worker/src/browser/browser.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { Browser, BrowserContext, chromium, Page } from 'playwright';

interface ActiveSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

@Injectable()
export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);
  private activePages = new Map<string, Page>();
  private sessions = new Map<string, ActiveSession>();

  async stopSession(sessionId: string): Promise<void> {
    this.logger.log(`[BrowserService] Починаємо процес зупинки сесії: ${sessionId}`);

    // 1. Знаходимо сесію в пам'яті
    const session = this.sessions.get(sessionId);

    if (!session) {
      this.logger.warn(
        `[BrowserService] Сесію ${sessionId} не знайдено. Можливо, вона вже закрита або впала раніше.`
      );
      return;
    }

    const { browser, context, page } = session;

    try {
      // 2. Закриваємо об'єкти по черзі, починаючи з найменшого (щоб уникнути помилок TargetClosed)

      // Перевіряємо, чи сторінка ще не закрита крашем
      if (!page.isClosed()) {
        await page.close();
      }

      // Закриваємо контекст (це очистить кеш, куки для цієї сесії)
      await context.close();

      // Закриваємо сам процес браузера
      await browser.close();

      this.logger.log(`[BrowserService] Playwright інстанси для ${sessionId} успішно закриті.`);
    } catch (error) {
      this.logger.error(
        `[BrowserService] Помилка під час закриття процесів Playwright для ${sessionId}:`,
        error
      );
      // Кидаємо помилку далі, щоб контролер міг зробити channel.nack()
      throw error;
    } finally {
      // 3. НАЙВАЖЛИВІШЕ: Видаляємо об'єкт з Map у блоці finally.
      // Навіть якщо сталася помилка при закритті (наприклад, сторінка зависла),
      // ми повинні видалити посилання з пам'яті Node.js (Garbage Collection),
      // інакше отримаємо витік пам'яті (Memory Leak).
      this.sessions.delete(sessionId);
      this.logger.log(`[BrowserService] Сесію ${sessionId} видалено з реєстру активних сесій.`);
    }
  }

  async launchSession(
    sessionId: string,
    url: string,
    viewport: { width: number; height: number },
    authData: { email: string; password: string },
    allowedRoutes: string[],
    forbiddenSelectors: string[]
  ) {
    // 1. Ізоляція: Створюємо унікальну директорію для сесії (збереження куків, кешу)
    const userDataDir = path.join('/tmp/playwright_sessions', sessionId);

    this.logger.log(`Запуск Playwright для сесії ${sessionId}, ${viewport}`);
    const safeWidth = Math.min(viewport.width, 1920);
    const safeHeight = Math.min(viewport.height, 1080);
    const args = [
      // '--display=:99',
      `--window-size=${safeWidth},${safeHeight}`,
      '--window-position=0,0',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      '--disable-gpu',
      '--ignore-certificate-errors',
    ];
    // if (process.env.NODE_ENV === 'production') {
    //   args.push('--display=:99');
    // }

    // Запускаємо persistentContext з прив'язкою до віртуального дисплея Xvfb (:99)
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Обов'язково false для Xvfb
      viewport,
      args,
    });

    const page = await context.newPage();
    this.activePages.set(sessionId, page);
    const targetOrigin = new URL(url).origin;

    // 2. Обмеження: Блокування роутів (AllowedRoutes)
    await this.applyRouteRestrictions(page, allowedRoutes, targetOrigin);

    // 3. Автологін (Сценарій)
    await this.performAutoLogin(page, url, authData);

    // 4. Обмеження: Блокування кнопок (ForbiddenSelectors)
    await this.applyUIConstraints(page, forbiddenSelectors);

    return page;
  }

  private async applyRouteRestrictions(page: Page, allowedRoutes: string[], targetOrigin: string) {
    // 4. Захист: Блокуємо переходи на заборонені домени
    await page.route('**/*', (route) => {
      const requestUrl = route.request().url();

      // ДОДАЄМО ПЕРЕВІРКУ: чи починається запит з базового домену цільового сайту
      const isTargetDomain = requestUrl.startsWith(targetOrigin);
      const isExplicitlyAllowed = allowedRoutes.some((allowed) => requestUrl.startsWith(allowed));

      const isAllowed = isTargetDomain || isExplicitlyAllowed;

      if (
        isAllowed ||
        requestUrl.includes('.js') ||
        requestUrl.includes('.css') ||
        requestUrl.includes('.png') ||
        requestUrl.includes('.jpg')
      ) {
        route.continue();
      } else {
        this.logger.warn(`Блокування переходу: ${requestUrl}`);
        route.abort('accessdenied'); // Саме це і викликало ERR_ACCESS_DENIED
      }
    });
  }

  private async applyUIConstraints(page: Page, forbiddenSelectors: string[]) {
    if (!forbiddenSelectors || forbiddenSelectors.length === 0) return;

    // Створюємо CSS правило для приховування елементів
    const cssContent = `
      ${forbiddenSelectors.join(', ')} { 
        display: none !important; 
        pointer-events: none !important; 
        opacity: 0 !important;
      }
    `;

    // Застосовуємо стилі при кожному новому завантаженні сторінки або навігації
    await page.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
      });
    }, cssContent);

    // Також інжектуємо JS для блокування кліків (додатковий рівень захисту)
    await page.addInitScript((selectors) => {
      document.addEventListener(
        'click',
        (e) => {
          const target = e.target as HTMLElement;
          const isForbidden = selectors.some((selector) => target.closest(selector));
          if (isForbidden) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Клік заблоковано системою безпеки.');
          }
        },
        true
      ); // Захоплюємо подію на фазі занурення
    }, forbiddenSelectors);
  }

  private async performAutoLogin(page: Page, url: string, authData: any) {
    this.logger.log(`Автологін на ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });

    // ПРИКЛАД: Логіка заповнення форми.
    // У реальності тут може бути вставка cookies або виклик API для отримання токена
    try {
      const emailInput = await page.$(
        'input[type="email"], input[name="email"], input[name="username"]'
      );
      const passInput = await page.$('input[type="password"], input[name="password"]');

      if (emailInput && passInput) {
        await emailInput.fill(authData.email);
        await passInput.fill(authData.password);
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle' });
      }
    } catch (e) {
      this.logger.error('Помилка автологіну', e);
    }
  }

  // Метод для передачі кліків від користувача (через WebRTC DataChannel)
  async interact(sessionId: string, action: any) {
    const page = this.activePages.get(sessionId);
    if (!page) return;

    if (action.type === 'click') {
      await page.mouse.click(action.x, action.y);
    } else if (action.type === 'keydown') {
      // Блокуємо F12 на рівні Worker-а про всяк випадок
      if (action.key === 'F12') return;
      await page.keyboard.press(action.key);
    }
  }
}
