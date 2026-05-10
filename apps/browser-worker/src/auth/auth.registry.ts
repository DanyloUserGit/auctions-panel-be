import { Injectable, Logger } from '@nestjs/common';
import { IAuthStrategy } from './auth-strategy.interface';

@Injectable()
export class AuthStrategyRegistry {
    private strategies = new Map<string, IAuthStrategy>();
    private readonly logger = new Logger(AuthStrategyRegistry.name);

    register(strategy: IAuthStrategy) {
        this.strategies.set(strategy.url, strategy);
        this.logger.debug(`Зареєстровано стратегію автологіну: ${strategy.url}`);
    }

    get(targetUrl: string): IAuthStrategy | undefined {
        // 1. Спочатку перевіряємо точний збіг (працює найшвидше)
        if (this.strategies.has(targetUrl)) {
            return this.strategies.get(targetUrl);
        }

        // 2. Якщо точного збігу немає, розбираємо URL і порівнюємо хости
        try {
            const parsedTargetUrl = new URL(targetUrl);

            for (const [strategyUrl, strategy] of this.strategies.entries()) {
                const parsedStrategyUrl = new URL(strategyUrl);

                // Порівнюємо домени (наприклад, carmarket.ayvens.com === carmarket.ayvens.com)
                if (parsedTargetUrl.hostname === parsedStrategyUrl.hostname) {
                    this.logger.debug(`Стратегію знайдено за доменом для URL: ${targetUrl}`);
                    return strategy;
                }
            }
        } catch (error) {
            this.logger.warn(`Помилка парсингу URL при пошуку стратегії: ${targetUrl}`);
        }

        // 3. Fallback варіант: шукаємо через startsWith
        // (на випадок, якщо цільовий URL був відносним або некоректним для класу URL)
        for (const [strategyUrl, strategy] of this.strategies.entries()) {
            if (targetUrl.startsWith(strategyUrl)) {
                this.logger.debug(`Стратегію знайдено через startsWith для URL: ${targetUrl}`);
                return strategy;
            }
        }

        return undefined; // Якщо нічого не підійшло
    }

}