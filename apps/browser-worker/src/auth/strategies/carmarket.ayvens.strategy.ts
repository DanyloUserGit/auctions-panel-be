import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { AuthData, IAuthStrategy } from '../auth-strategy.interface';

@Injectable()
export class CarmarketAyvensAuthStrategy implements IAuthStrategy {
    readonly url = 'https://carmarket.ayvens.com/';
    private readonly logger = new Logger(CarmarketAyvensAuthStrategy.name);

    async login(page: Page, authData: AuthData): Promise<void> {
        if (!authData.email || !authData.password) return;

        this.logger.log(`Переходимо на сторінку автологіну: ${this.url}`);
        await page.goto(this.url, { waitUntil: 'domcontentloaded' });

        try {
            await page.waitForSelector("#onetrust-accept-btn-handler", { timeout: 5000 });
            await page.click("#onetrust-accept-btn-handler");
        } catch (e) {
            this.logger.debug('Банер з куками не знайдено або вже прийнято.');
        }

        await page.click("#btn_signIn");

        await page.waitForSelector('#userName', { state: 'visible', timeout: 5000 });

        await page.fill('#userName', authData.email);
        await page.fill('#password', authData.password);

        await Promise.all([
            page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { }),
            page.click('button[type="submit"]')
        ]);

        const closeBtnSelector = '.ayvens-icon.ayvens-icon-close';
        try {
            await page.waitForSelector(closeBtnSelector, { state: 'visible', timeout: 10000 });
            await page.click(closeBtnSelector);
        } catch (error) {
            this.logger.warn('Іконку закриття не знайдено, можливо вікно не з\'явилось. Продовжуємо...');
        }

        this.logger.log('Успішний логін!');
    }
}