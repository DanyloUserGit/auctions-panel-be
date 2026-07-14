import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { dismissIfPresent, safeClick, toggleMask } from '../auth-mask.util';
import { AuthData, IAuthStrategy } from '../auth-strategy.interface';

@Injectable()
export class CarmarketAyvensAuthStrategy implements IAuthStrategy {
    readonly url = 'https://carmarket.ayvens.com/';
    private readonly logger = new Logger(CarmarketAyvensAuthStrategy.name);

    async login(page: Page, authData: AuthData): Promise<void> {
        if (!authData.email || !authData.password) return;

        this.logger.log(`Починаємо автологін на: ${this.url}`);

        try {
            await toggleMask(page, true, 'Виконуємо вхід у систему...');

            const cookiesClosed = await dismissIfPresent(page, '#onetrust-accept-btn-handler');
            this.logger.debug(cookiesClosed ? 'Банер з куками закрито.' : 'Банер з куками не знайдено.');

            const popupClosed = await dismissIfPresent(page, '.ab_widget_container_popin-image_close_button');
            this.logger.debug(popupClosed ? 'Промо-попап закрито.' : 'Промо-попап не знайдено.');

            await page.waitForSelector('#btn_signIn', { state: 'visible', timeout: 10000 });
            await safeClick(page, '#btn_signIn');

            await page.waitForSelector('#userName', { state: 'visible', timeout: 15000 });
            await page.fill('#userName', authData.email);
            await page.fill('#password', authData.password);

            await safeClick(page, 'button[type="submit"]');

            await page.waitForSelector('#userName', { state: 'hidden', timeout: 15000 });
            this.logger.log('Успішний логін!');
        } catch (error) {
            this.logger.error('Помилка під час автологіну:', error);
        } finally {
            await toggleMask(page, false).catch(() => { });
        }
    }
}