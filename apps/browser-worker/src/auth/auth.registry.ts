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

    get(name: string): IAuthStrategy | undefined {
        return this.strategies.get(name);
    }
}