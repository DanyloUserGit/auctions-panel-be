import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { dismissIfPresent, safeClick, toggleMask } from '../auth-mask.util';
import { AuthData, IAuthStrategy } from '../auth-strategy.interface';

@Injectable()
export class VantesvoFraikinStrategy implements IAuthStrategy {
    readonly url = 'https://ventesvo.fraikin.fr/';
    private readonly logger = new Logger(VantesvoFraikinStrategy.name);

    async login(page: Page, authData: AuthData): Promise<void> {
        if (!authData.email || !authData.password) return;

        this.logger.log(`Починаємо автологін на: ${this.url}`);

        try {

            await page.goto("https://ventesvo.fraikin.fr/cgi-bin/gticglnk/CHWA002?ID_USER=HRAC2395245931&LANGUE=EN&PROGRAMME=CRITERE2")

            await page.waitForLoadState('networkidle').catch(() => { });

            await toggleMask(page, true, 'Виконуємо вхід у систему...');

            await page.waitForSelector('[name="CD_LOGIN"]', { state: 'visible', timeout: 15000 });
            await page.fill('[name="CD_LOGIN"]', authData.email);
            await page.fill('[name="PASS"]', authData.password);
            await safeClick(page, '[name="FRContinuer"]');
        } catch (error) {
            this.logger.error('Помилка під час автологіну:', error);
        } finally {
            await toggleMask(page, false).catch(() => { });
        }
    }
}