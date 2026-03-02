import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { BrowserWorkerController } from './browser-worker.controller';
import { BrowserService } from './browser-worker.service';
import { WebrtcService } from '../webrtc/webrtc.service';

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
  providers: [BrowserService, WebrtcService],
})
export class BrowserWorkerModule { }