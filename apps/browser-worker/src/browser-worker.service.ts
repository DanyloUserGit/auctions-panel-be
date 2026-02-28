// apps/browser-worker/src/browser/browser.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { chromium, BrowserContext, Page } from 'playwright';
import * as path from 'path';

@Injectable()
export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);
  private activePages = new Map<string, Page>();

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

    this.logger.log(`Запуск Playwright для сесії ${sessionId}`);

    const args = [
      // '--display=:99',
      `--window-size=${viewport.width},${viewport.height}`,
      '--window-position=0,0',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      '--ignore-certificate-errors',
    ];
    if (process.env.NODE_ENV === 'production') {
      args.push('--display=:99');
    }

    // Запускаємо persistentContext з прив'язкою до віртуального дисплея Xvfb (:99)
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Обов'язково false для Xvfb
      viewport,
      args
    });


    const page = await context.newPage();
    this.activePages.set(sessionId, page);

    // 2. Обмеження: Блокування роутів (AllowedRoutes)
    await this.applyRouteRestrictions(page, allowedRoutes);

    // 3. Автологін (Сценарій)
    await this.performAutoLogin(page, url, authData);

    // 4. Обмеження: Блокування кнопок (ForbiddenSelectors)
    await this.applyUIConstraints(page, forbiddenSelectors);

    return page;
  }

  private async applyRouteRestrictions(page: Page, allowedRoutes: string[]) {
    await page.route('**/*', (route) => {
      const request = route.request();
      const requestUrl = request.url();
      const resourceType = request.resourceType();

      // Дозволяємо завантажувати статику (картинки, стилі, скрипти) звідусіль, 
      // щоб сайт не "зламався" візуально
      if (['stylesheet', 'image', 'font', 'script'].includes(resourceType)) {
        return route.continue();
      }

      // Перевіряємо, чи входить базовий URL у список дозволених
      const isAllowed = allowedRoutes.some(allowedUrl => requestUrl.startsWith(allowedUrl));

      if (isAllowed || requestUrl === 'about:blank') {
        route.continue();
      } else {
        this.logger.warn(`Блокування переходу: ${requestUrl}`);
        route.abort('accessdenied');
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
      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const isForbidden = selectors.some(selector => target.closest(selector));
        if (isForbidden) {
          e.preventDefault();
          e.stopPropagation();
          console.log('Клік заблоковано системою безпеки.');
        }
      }, true); // Захоплюємо подію на фазі занурення
    }, forbiddenSelectors);
  }

  private async performAutoLogin(page: Page, url: string, authData: any) {
    this.logger.log(`Автологін на ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });

    // ПРИКЛАД: Логіка заповнення форми. 
    // У реальності тут може бути вставка cookies або виклик API для отримання токена
    try {
      const emailInput = await page.$('input[type="email"], input[name="email"], input[name="username"]');
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