import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { AuthData, IAuthStrategy } from '../auth-strategy.interface';

@Injectable()
export class Auto1Strategy implements IAuthStrategy {
    readonly url = 'https://www.auto1.com/';
    private readonly logger = new Logger(Auto1Strategy.name);

    async login(page: Page, authData: AuthData): Promise<void> {
        if (!authData.email || !authData.password) {
            this.logger.warn('Не передано email або пароль для логіну.');
            return;
        }

        this.logger.log(`Переходимо на сторінку автологіну: ${this.url}`);
        await page.goto(this.url, { waitUntil: 'domcontentloaded' });

        // 1. Обробка кукі-банера
        try {
            await page.waitForSelector('[data-testid="cookie-banner-accept-all-cookies-button"]', { timeout: 5000 });
            await page.click('[data-testid="cookie-banner-accept-all-cookies-button"]');
            this.logger.debug('Куки прийнято.');
        } catch (e) {
            this.logger.debug('Банер з куками не знайдено або вже прийнято.');
        }

        // 2. Перехід до форми логіну
        await page.click('[data-testid="header-login-button"]', {timeout: 1000});

        const emailSelector = '[data-testid="login-popup-email"]';
        const passwordSelector = '[data-testid="login-popup-password"]';
        await page.waitForSelector(emailSelector, { state: 'visible', timeout: 4000 });

        // 3. Імітація введення людиною (захист від ботів)
        // Використовуємо pressSequentially із затримкою замість миттєвого fill
        this.logger.debug('Вводимо облікові дані...');
        await page.locator(emailSelector).pressSequentially(authData.email, { delay: 500 });
        await page.locator(passwordSelector).pressSequentially(authData.password, { delay: 500 });

        // 4. Клік по кнопці (без networkidle)
        // Бажано уточнити селектор кнопки, щоб не клікнути випадкову форму
        await page.locator('[data-testid="login-popup-action-button"]').first().click();

    }
}