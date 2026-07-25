import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { dismissIfPresent, safeClick, toggleMask } from '../auth-mask.util';
import { AuthData, IAuthStrategy } from '../auth-strategy.interface';

@Injectable()
export class VpautoAuthStrategy implements IAuthStrategy {
    readonly url = 'https://vpauto.eu/pro';
    private readonly logger = new Logger(VpautoAuthStrategy.name);

    async login(page: Page, authData: AuthData): Promise<void> {
        if (!authData.email || !authData.password) return;

        this.logger.log(`Починаємо автологін на: ${this.url}`);

        try {
            await toggleMask(page, false).catch(() => { });

            await page.hover('.compte', { force: true });

            await page.waitForSelector('.lien-compte-pro', { state: 'visible', timeout: 5000 });
            await safeClick(page, '.lien-compte-pro');

            await toggleMask(page, true, 'Виконуємо вхід у систему...');

            await page.waitForNavigation({
                waitUntil: 'domcontentloaded',
                timeout: 30000
            }).catch((err) => {
                this.logger.warn('Очікування навігації завершилось таймаутом або це був AJAX запит. Продовжуємо...');
            });

            await toggleMask(page, true, 'Виконуємо вхід у систему...');
            await page.waitForSelector('[type="email"]', { state: 'visible', timeout: 15000 });
            await page.fill('[type="email"]', authData.email);
            await safeClick(page, 'button[type="submit"]');
            await page.waitForSelector('[type="password"]', { state: 'visible', timeout: 15000 });
            await page.fill('[type="password"]', authData.password);
            await safeClick(page, 'button[type="submit"]');
        } catch (error) {
            this.logger.error('Помилка під час автологіну:', error);
        } finally {
            await toggleMask(page, false).catch(() => { });
        }
    }
}