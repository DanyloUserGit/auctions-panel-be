import { Logger } from '@nestjs/common';
import { Page } from 'playwright';

const logger = new Logger('AuthMaskUtil');

export async function toggleMask(
    page: Page,
    show: boolean,
    message: string = 'Виконуємо вхід у систему...',
    retries = 0,
): Promise<void> {
    try {
        await page.evaluate(({ show, message }) => {
            let overlay = document.getElementById('pw-auth-overlay');
            if (show) {
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.id = 'pw-auth-overlay';
                    Object.assign(overlay.style, {
                        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
                        backgroundColor: 'rgba(0, 0, 0, 0.8)', backdropFilter: 'blur(12px)',
                        color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '28px', fontFamily: 'sans-serif', zIndex: '2147483647',
                        pointerEvents: 'all',
                    });
                    document.body.appendChild(overlay);
                }
                overlay.innerText = message;
                overlay.style.display = 'flex';
            } else if (overlay) {
                overlay.style.display = 'none';
            }
        }, { show, message });
    } catch (error: any) {
        const isNavigationError =
            error.message?.includes('Execution context was destroyed') ||
            error.message?.includes('Target page, context or browser has been closed');

        if (!isNavigationError) throw error;
        if (!show) return;

        if (retries >= 3) {
            logger.error('Не вдалося накласти маску після кількох спроб перезавантаження.');
            return;
        }
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await new Promise((resolve) => setTimeout(resolve, 500));
        await toggleMask(page, show, message, retries + 1);
    }
}

export async function safeClick(
    page: Page,
    selector: string,
    options: { timeout?: number } = {},
): Promise<void> {
    const locator = page.locator(selector).first();
    try {
        await locator.click(options);
    } catch {
        await locator.evaluate((node: HTMLElement) => node.click());
    }
}

export async function dismissIfPresent(
    page: Page,
    selector: string,
    timeout = 5000,
): Promise<boolean> {
    try {
        await page.locator(selector).first().waitFor({ state: 'visible', timeout });
        await safeClick(page, selector, { timeout: 2000 });
        return true;
    } catch {
        return false;
    }
}