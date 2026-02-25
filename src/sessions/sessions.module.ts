import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { PrismaModule } from 'src/prisma/prisma.module';

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
    PrismaModule
  ],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule { }
