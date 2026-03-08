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
      '--kiosk',
      '--hide-scrollbars',
      '--disable-infobars',
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
    //  args.push('--display=:99');
    // }

    // Запускаємо persistentContext з прив'язкою до віртуального дисплея Xvfb (:99)
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Обов'язково false для Xvfb
      viewport,
      args,
    });

    const page = await context.newPage();
    this.activePages.set(sessionId, page);

    await page.addInitScript(() => {
      // Спрацьовує, коли DOM завантажився
      window.addEventListener('DOMContentLoaded', () => {
        const cursor = document.createElement('div');
        cursor.id = 'playwright-custom-cursor';

        // Стилізуємо курсор (можете замінити на картинку мишки)
        Object.assign(cursor.style, {
          width: '12px',
          height: '12px',
          backgroundColor: 'rgba(255, 0, 0, 0.8)', // Червона крапка (щоб добре бачити)
          border: '2px solid white',
          borderRadius: '50%',
          position: 'fixed',
          top: '0',
          left: '0',
          pointerEvents: 'none', // ДУЖЕ ВАЖЛИВО! Щоб курсор не блокував кліки під собою
          zIndex: '2147483647',  // Поверх усього
          transform: 'translate(-50%, -50%)', // Центруємо крапку
          transition: 'transform 0.05s linear' // Трохи згладжуємо рух
        });

        document.body.appendChild(cursor);

        // Рухаємо наш елемент за реальними координатами миші Playwright
        document.addEventListener('mousemove', (e) => {
          cursor.style.transform = `translate(calc(${e.clientX}px - 50%), calc(${e.clientY}px - 50%))`;
        });
      });
    });

    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.textContent = `
          *::-webkit-scrollbar { display: none !important; }
          body { -ms-overflow-style: none !important; scrollbar-width: none !important; }
        `;
        document.head.appendChild(style);
      });
    });

    page.on('load', async () => {
      try {
        this.logger.debug(`[${sessionId}] Сторінка завантажена, форсуємо F11`);
        await page.keyboard.press('F11');
      } catch (e) {
        this.logger.warn(`[${sessionId}] Не вдалося натиснути F11:`, e.message);
      }
    });

    const targetOrigin = new URL(url).origin;

    // 2. Обмеження: Блокування роутів (AllowedRoutes)
    await this.applyRouteRestrictions(page, [...allowedRoutes, 'https://login.bca.com/'], targetOrigin);

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

  private async performAutoLogin(page: Page, url: string, authData: { email: string, password: string }) {
    console.log("Autologin start")
    this.logger.log(`Автологін на ${url}`);

    // try {
    //   // 1. Змінюємо очікування на 'domcontentloaded' - це часто працює краще для Angular
    //   await page.goto(url, { waitUntil: 'domcontentloaded' });

    //   // 2. ДІАГНОСТИКА: Чекаємо, поки кнопка Login з'явиться ВІЗУАЛЬНО.
    //   // Якщо сторінка пуста, скрипт впаде ТУТ із зрозумілою помилкою, а не пізніше.
    //   const loginTrigger = page.locator('[data-el="login"]');
    //   this.logger.log('Чекаємо на повний рендер сторінки (появу кнопки Login)...');
    //   await loginTrigger.waitFor({ state: 'visible', timeout: 15000 });
    //   this.logger.log('Сторінка успішно відобразилась!');

    //   // 3. Обробка банера Cookies
    //   const acceptCookiesBtn = page.locator('#onetrust-accept-btn-handler');
    //   try {
    //     await acceptCookiesBtn.waitFor({ state: 'visible', timeout: 3000 });
    //     await acceptCookiesBtn.click();
    //     this.logger.log('Кукі прийнято.');
    //   } catch (e) {
    //     this.logger.log('Банер кукісів не знайдено, йдемо далі.');
    //   }

    //   // 4. Клікаємо на кнопку Login
    //   await loginTrigger.click();

    //   // 5. Чекаємо появи поля вводу
    //   const usernameInput = page.locator('#username');
    //   await usernameInput.waitFor({ state: 'visible', timeout: 10000 });

    //   // 6. Вводимо дані
    //   await usernameInput.fill(authData.email);
    //   await page.locator('#password').fill(authData.password);

    //   // 7. Клікаємо Увійти
    //   await page.locator('#loginButton').click();

    //   this.logger.log('Дані введено, чекаємо на логін...');
    //   await page.screenshot({ path: 'debug-screen.png', fullPage: true });
    //   this.logger.debug('📸 Скріншот збережено у debug-screen.png');
    //   await page.waitForLoadState('networkidle');

    // } catch (e) {
    //   this.logger.error('Помилка під час виконання автологіну:', e);
    //   // ДУЖЕ КОРИСНО: Робимо скріншот у разі помилки, щоб побачити, що саме бачить Playwright
    //   // (навіть якщо трансляція показує пустий екран)
    //   try {
    //     await page.screenshot({ path: `/tmp/error-login-${Date.now()}.png` });
    //     this.logger.log('Скріншот помилки збережено у /tmp/');
    //   } catch (screenshotError) {
    //     this.logger.error('Не вдалося зробити скріншот', screenshotError);
    //   }
    // }
  }

  // Метод для передачі кліків від користувача (через WebRTC DataChannel)
  async interact(sessionId: string, action: any) {
    const page = this.activePages.get(sessionId);
    if (!page) return;

    try {
      switch (action.type) {
        case 'mousemove':
          await page.mouse.move(action.x, action.y);
          break;

        case 'mousedown':
          // button: 0 (ліва), 1 (коліщатко), 2 (права) у React, 
          // а в Playwright це 'left', 'middle', 'right'
          const downBtn = action.button === 2 ? 'right' : action.button === 1 ? 'middle' : 'left';
          await page.mouse.down({ button: downBtn });
          break;

        case 'mouseup':
          const upBtn = action.button === 2 ? 'right' : action.button === 1 ? 'middle' : 'left';
          await page.mouse.up({ button: upBtn });
          break;

        case 'click': // Якщо захочете використовувати click замість down/up
          await page.mouse.click(action.x, action.y);
          break;

        case 'wheel':
          await page.mouse.wheel(action.deltaX, action.deltaY);
          break;

        case 'keydown':
          // Playwright може кидати помилки на деякі специфічні клавіші (наприклад 'Dead')
          if (action.key.length === 1 || this.isValidPlaywrightKey(action.key)) {
            await page.keyboard.down(action.key);
          }
          break;

        case 'keyup':
          if (action.key.length === 1 || this.isValidPlaywrightKey(action.key)) {
            await page.keyboard.up(action.key);
          }
          break;
      }
    } catch (e) {
      // Ігноруємо дрібні помилки типу "невідома клавіша", щоб не спамити логи
      this.logger.debug(`[Browser] Не вдалося виконати дію ${action.type}: ${e.message}`);
    }
  }

  // Допоміжний метод, щоб відсіяти системні клавіші, які Playwright не розуміє
  private isValidPlaywrightKey(key: string): boolean {
    const validKeys = [
      'Backspace', 'Tab', 'Enter', 'Shift', 'Control', 'Alt', 'CapsLock', 'Escape',
      'PageUp', 'PageDown', 'End', 'Home', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
      'Insert', 'Delete', 'Meta' // Meta = Win/Cmd
    ];
    return validKeys.includes(key);
  }
}
