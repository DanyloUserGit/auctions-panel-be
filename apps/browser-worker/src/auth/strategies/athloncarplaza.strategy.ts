import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { dismissIfPresent, safeClick, toggleMask } from '../auth-mask.util';
import { AuthData, IAuthStrategy } from '../auth-strategy.interface';

const LOGIN_TEXT_BY_LOCALE: Record<string, string> = {
    'de-de': 'Anmelden',
    'es-es': 'Acceso',
    'pl-pl': 'Logowanie',
    'nl-nl': 'Inloggen',
};
function getLoginSelector(url: string): string {
    const localeMatch = url.match(/\/([a-z]{2}-[a-z]{2})/i);
    const locale = localeMatch?.[1]?.toLowerCase() ?? 'en';
    const text = LOGIN_TEXT_BY_LOCALE[locale] ?? 'Login';
    return `text= ${text}`;
}
@Injectable()
export class AthloncarplazaAuthStrategy implements IAuthStrategy {
    readonly url = 'https://www.athloncarplaza.com/';
    private readonly logger = new Logger(AthloncarplazaAuthStrategy.name);

    async login(page: Page, authData: AuthData): Promise<void> {
        if (!authData.email || !authData.password) return;

        this.logger.log(`Починаємо автологін на: ${this.url}`);

        try {
            
            await toggleMask(page, true, 'Виконуємо вхід у систему...');

            const cookiesClosed = await dismissIfPresent(page, '.accept-all-btn');
            this.logger.debug(cookiesClosed ? 'Банер з куками закрито.' : 'Банер з куками не знайдено.');

            let LOGIN_BUTTON = getLoginSelector(page.url());
            console.log(page.url(), LOGIN_BUTTON)
            await page.waitForSelector(LOGIN_BUTTON, { state: 'visible', timeout: 5000 });
            await safeClick(page, LOGIN_BUTTON);

            await page.waitForNavigation({
                waitUntil: 'domcontentloaded',
                timeout: 30000
            }).catch((err) => {
                this.logger.warn('Очікування навігації завершилось таймаутом або це був AJAX запит. Продовжуємо...');
            });
            await toggleMask(page, true, 'Виконуємо вхід у систему...');
            await page.waitForSelector('#Username', { state: 'visible', timeout: 15000 });
            await page.fill('#Username', authData.email);
            await page.fill('#Password', authData.password);
            await safeClick(page, '#AcceptTerms');
            await safeClick(page, '[value="login"]');
        } catch (error) {
            this.logger.error('Помилка під час автологіну:', error);
        } finally {
            await toggleMask(page, false).catch(() => { });
        }
    }
}