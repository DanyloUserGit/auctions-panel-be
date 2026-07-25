import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AuthStrategyRegistry } from './auth/auth.registry';
import { AlcopaStrategy } from './auth/strategies/alcopa-auction.strategy';
import { AthloncarplazaAuthStrategy } from './auth/strategies/athloncarplaza.strategy';
import { Auto1Strategy } from './auth/strategies/auto1.strategy';
import { CarmarketAyvensAuthStrategy } from './auth/strategies/carmarket.ayvens.strategy';
import { VantesvoFraikinStrategy } from './auth/strategies/ventesvoFraikin.strategy';
import { VpautoAuthStrategy } from './auth/strategies/vpauto.strategy';
import { BrowserWorkerController } from './browser-worker.controller';
import { BrowserService } from './browser-worker.service';
import { WebrtcService } from './webrtc/webrtc.service';

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
  providers: [
    BrowserService,
    WebrtcService,
    AuthStrategyRegistry,
    CarmarketAyvensAuthStrategy,
    Auto1Strategy,
    AlcopaStrategy,
    AthloncarplazaAuthStrategy,
    VantesvoFraikinStrategy,
    VpautoAuthStrategy
  ],
})
export class BrowserWorkerModule {
  constructor(
    private registry: AuthStrategyRegistry,
    private carmarketAyvensAuthStrategy: CarmarketAyvensAuthStrategy,
    private auto1Strategy: Auto1Strategy,
    private alcopaStrategy: AlcopaStrategy,
    private athloncarplazaAuthStrategy: AthloncarplazaAuthStrategy,
    private vantesvoFraikinStrategy: VantesvoFraikinStrategy,
    private vpautoAuthStrategy: VpautoAuthStrategy,
  ) {
    this.registry.register(this.carmarketAyvensAuthStrategy);
    this.registry.register(this.auto1Strategy);
    this.registry.register(this.alcopaStrategy);
    this.registry.register(this.athloncarplazaAuthStrategy);
    this.registry.register(this.vantesvoFraikinStrategy);
    this.registry.register(this.vpautoAuthStrategy);
  }
}
