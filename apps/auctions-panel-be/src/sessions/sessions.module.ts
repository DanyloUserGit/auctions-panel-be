import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SessionsController } from './sessions.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionsService } from './sessions.service';
import { SessionGateway } from './session.gateway';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'WORKER_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: ['amqp://localhost:5672'],
          queue: 'browser_sessions_queue',
          queueOptions: {
            durable: true,
          },
        },
      },
    ]),
    PrismaModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionGateway],
})
export class SessionsModule {}
