import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { dismissIfPresent, safeClick, toggleMask } from '../auth-mask.util';
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

        this.logger.log(`Починаємо автологін на: ${this.url}`);

        try {
            await toggleMask(page, true, 'Виконуємо вхід у систему...');

            const cookiesClosed = await dismissIfPresent(page, '[data-testid="cookie-banner-accept-all-cookies-button"]');
            this.logger.debug(cookiesClosed ? 'Куки прийнято.' : 'Банер з куками не знайдено.');

            await page.waitForSelector('[data-testid="header-login-button"]', { state: 'visible', timeout: 10000 });
            await safeClick(page, '[data-testid="header-login-button"]');

            const emailSelector = '[data-testid="login-popup-email"]';
            const passwordSelector = '[data-testid="login-popup-password"]';
            await page.waitForSelector(emailSelector, { state: 'visible', timeout: 8000 });

            this.logger.debug('Вводимо облікові дані...');
            await page.locator(emailSelector).pressSequentially(authData.email, { delay: 500 });
            await page.locator(passwordSelector).pressSequentially(authData.password, { delay: 500 });

            await safeClick(page, '[data-testid="login-popup-action-button"]');
            this.logger.log('Форму входу відправлено.');
        } catch (error) {
            this.logger.error('Помилка під час автологіну:', error);
        } finally {
            await toggleMask(page, false).catch(() => { });
        }
    }
}