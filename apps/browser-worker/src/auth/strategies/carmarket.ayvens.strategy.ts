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

        try {
            const popupCloseSelector = '.ab_widget_container_popin-image_close_button';
            await page.waitForSelector(popupCloseSelector, { state: 'visible', timeout: 5000 });
            await page.click(popupCloseSelector);
            this.logger.debug('Віджет/попап успішно закрито.');
        } catch (e) {
            this.logger.debug('Віджет/попап не знайдено або не з\'явився.');
        }

        await page.waitForSelector("#btn_signIn", { state: 'visible', timeout: 5000 });
        this.logger.debug('Знаходимо кнопку входу та клікаємо її.');
        await page.click("#btn_signIn");

        await page.waitForSelector('#userName', { state: 'visible', timeout: 15000 });
        await page.fill('#userName', authData.email);
        this.logger.debug('Заповнюємо поле email.');


        await page.fill('#password', authData.password);
        this.logger.debug('Заповнюємо поле пароля.');

        await page.click('button[type="submit"]');
        this.logger.debug('Натискаємо кнопку входу.');

        await page.waitForSelector('#userName', { state: 'hidden', timeout: 15000 });

        this.logger.log('Успішний логін!');
    }
}