import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SessionsController } from './sessions.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionsService } from './sessions.service';
import { SessionGateway } from './session.gateway';
import { SessionsApiController } from './sessions-api.controller';
import { SessionLoggerModule } from '../session-logger/session-logger.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'WORKER_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://127.0.0.1:5672'],
          queue: 'browser_sessions_queue',
          queueOptions: {
            durable: true,
          },
        },
      },
    ]),
    // Секрет передається явно у SessionGateway (JWT_SECRET), як і в JwtStrategy.
    JwtModule.register({}),
    PrismaModule,
    AccessModule,
    SessionLoggerModule,
    NotificationModule
  ],
  controllers: [SessionsController, SessionsApiController],
  providers: [SessionsService, SessionGateway],
})
export class SessionsModule {}
