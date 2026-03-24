import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { BrowserWorkerController } from './browser-worker.controller';
import { BrowserService } from './browser-worker.service';
import { WebrtcService } from './webrtc/webrtc.service';
import { AuthStrategyRegistry } from './auth/auth.registry';
import { CarmarketAyvensAuthStrategy } from './auth/strategies/carmarket.ayvens.strategy';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'API_CLIENT',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672'],
          queue: 'api_responses_queue',
          queueOptions: {
            durable: false,
          },
        },
      },
    ]),
  ],
  controllers: [BrowserWorkerController],
  providers: [BrowserService, WebrtcService, AuthStrategyRegistry, CarmarketAyvensAuthStrategy],
})
export class BrowserWorkerModule {
  constructor(
    private registry: AuthStrategyRegistry,
    private carmarketAyvensAuthStrategy: CarmarketAyvensAuthStrategy,
  ) {
    this.registry.register(this.carmarketAyvensAuthStrategy);
  }
}
