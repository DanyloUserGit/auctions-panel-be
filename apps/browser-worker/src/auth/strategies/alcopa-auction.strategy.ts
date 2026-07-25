import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { toggleMask } from '../auth-mask.util';
import { AuthData, IAuthStrategy } from '../auth-strategy.interface';

@Injectable()
export class AlcopaStrategy implements IAuthStrategy {
    readonly url = 'https://www.alcopa-auction.fr/';
    readonly isInteractive = true;
    private readonly logger = new Logger(AlcopaStrategy.name);

    async login(page: Page, authData: AuthData): Promise<void> {
        if (!authData.email || !authData.password) return;

        this.logger.log(`Починаємо інтерактивний логін: ${this.url}`);

        try {
            this.logger.log('Очікуємо, поки користувач пройде капчу і натисне Confirm...');

            await page.waitForNavigation({
                waitUntil: 'domcontentloaded',
                timeout: 30000
            }).catch((err) => {
                this.logger.warn('Очікування навігації завершилось таймаутом або це був AJAX запит. Продовжуємо...');
            });

            this.logger.log('Включаємо затінення екрану...');
            await toggleMask(page, true, 'Перевірка капчі... Виконуємо вхід у систему.');

            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });

            try {
                this.logger.log('Очікуємо на банер з куками (Cookiebot)...');
                const cookieBtn = page.locator('#CybotCookiebotDialogBodyButtonAccept');

                await cookieBtn.waitFor({ state: 'visible', timeout: 8000 });

                await cookieBtn.evaluate((node: HTMLElement) => node.click());
                this.logger.log('Куки успішно прийнято.');

                await page.waitForTimeout(500);
            } catch (e) {
                this.logger.debug('Банер з куками не знайдено (можливо, вже прийнято раніше).');
            }
            this.logger.log('Клікаємо на "Mon compte" для відкриття модалки...');

            const loginBtn = page.locator('btn[data-target="#modal-login-form"]:visible').first();

            await loginBtn.waitFor({ state: 'visible', timeout: 10000 });

            try {
                await loginBtn.click();
            } catch (error) {
                this.logger.warn('Стандартний клік перехоплено іншим елементом, викликаємо JS-клік...');
                await loginBtn.evaluate((node: HTMLElement) => node.click());
            }

            const emailSelector = '#modal-login-form input[name="email"]';
            await page.waitForSelector(emailSelector, { state: 'visible', timeout: 15000 });

            await page.waitForTimeout(500);

            this.logger.log('Вводимо кредо...');
            await page.fill(emailSelector, authData.email);

            const passwordSelector = '#modal-login-form input[name="password"]';
            await page.fill(passwordSelector, authData.password);

            this.logger.log('Натискаємо кнопку підтвердження входу...');
            const submitBtn = page.locator('#button_connect');

            await submitBtn.waitFor({ state: 'attached', timeout: 5000 });

            try {
                await page.press(passwordSelector, 'Enter');
            } catch (error) {
                this.logger.warn('Натискання Enter не пройшло, використовуємо JS-клік...');
                await submitBtn.evaluate((node: HTMLElement) => node.click());
            }

            this.logger.log('Очікуємо на перезавантаження сторінки після логіну...');
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });

            await toggleMask(page, true, 'Вхід успішний! Завантажуємо дані аукціону...');
            this.logger.log('Інтерактивний логін успішно завершено!');
        } catch (error) {
            this.logger.error('Помилка під час інтерактивного логіну:', error);
            await toggleMask(page, false);
        } finally {
            setTimeout(async () => await toggleMask(page, false).catch(() => { }), 3000);
        }
    }

}