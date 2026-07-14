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

            // 3. Сторінка оновилася. Включаємо блюр.
            this.logger.log('Включаємо затінення екрану...');
            await toggleMask(page, true, 'Перевірка капчі... Виконуємо вхід у систему.');

            // ДАЄМО САЙТУ ЧАС ІНІЦІАЛІЗУВАТИ СКРИПТИ (jQuery/Bootstrap)
            // Чекаємо, поки мережа трохи заспокоїться, або максимум 5 секунд
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });

            try {
                this.logger.log('Очікуємо на банер з куками (Cookiebot)...');
                const cookieBtn = page.locator('#CybotCookiebotDialogBodyButtonAccept');

                // Збільшуємо час очікування до 8 секунд і чекаємо саме 'visible'
                await cookieBtn.waitFor({ state: 'visible', timeout: 8000 });

                // Клікаємо через чистий JS — це ігнорує будь-які оверлеї, блюри та перекриття
                await cookieBtn.evaluate((node: HTMLElement) => node.click());
                this.logger.log('Куки успішно прийнято.');

                // ДУЖЕ ВАЖЛИВО: даємо банеру 500мс на те, щоб зникнути (анімація зникнення), 
                // щоб він не перекрив нашу кнопку "Mon compte"
                await page.waitForTimeout(500);
            } catch (e) {
                this.logger.debug('Банер з куками не знайдено (можливо, вже прийнято раніше).');
            }
            // 4. Клікаємо на кнопку логіну
            this.logger.log('Клікаємо на "Mon compte" для відкриття модалки...');

            // 💡 ПРОБЛЕМА БУЛА ТУТ: Додаємо псевдоклас :visible та .first() 
            // Це гарантує, що ми знайдемо саме ту кнопку, яку зараз бачить користувач на екрані.
            const loginBtn = page.locator('btn[data-target="#modal-login-form"]:visible').first();

            // Змінюємо 'attached' на 'visible', щоб дочекатися її фактичної появи
            await loginBtn.waitFor({ state: 'visible', timeout: 10000 });

            // Робимо клік без force: true, щоб Playwright перевірив "готовність" елемента.
            // Якщо ж якийсь прозорий оверлей перекриває кнопку, підстраховуємося через чистий JavaScript.
            try {
                await loginBtn.click();
            } catch (error) {
                this.logger.warn('Стандартний клік перехоплено іншим елементом, викликаємо JS-клік...');
                await loginBtn.evaluate((node: HTMLElement) => node.click());
            }

            // 5. Чекаємо на форму В СЕРЕДИНІ МОДАЛКИ
            const emailSelector = '#modal-login-form input[name="email"]';
            await page.waitForSelector(emailSelector, { state: 'visible', timeout: 15000 });

            // 🛑 ВАЖЛИВО: Чекаємо 500мс, щоб анімація появи модального вікна повністю завершилася
            await page.waitForTimeout(500);

            // 6. Вводимо дані
            this.logger.log('Вводимо кредо...');
            await page.fill(emailSelector, authData.email);

            const passwordSelector = '#modal-login-form input[name="password"]';
            await page.fill(passwordSelector, authData.password);

            this.logger.log('Натискаємо кнопку підтвердження входу...');
            const submitBtn = page.locator('#button_connect');

            // Чекаємо, щоб кнопка точно була готова
            await submitBtn.waitFor({ state: 'attached', timeout: 5000 });

            try {
                // ВАРІАНТ А (Рекомендований): Просто натискаємо Enter, знаходячись у полі паролю.
                // Це природно відправляє форму і обходить будь-які проблеми з кліками по кнопці.
                await page.press(passwordSelector, 'Enter');
            } catch (error) {
                // ВАРІАНТ Б (Резервний): Якщо Enter не спрацював, б'ємо напряму через JS
                this.logger.warn('Натискання Enter не пройшло, використовуємо JS-клік...');
                await submitBtn.evaluate((node: HTMLElement) => node.click());
            }

            // 7. Чекаємо на ознаку успішного входу (щоб не зняти блюр завчасно)
            this.logger.log('Очікуємо на перезавантаження сторінки після логіну...');
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });

            // Змінюємо текст блюру на успішний
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