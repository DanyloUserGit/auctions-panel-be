import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AccessModule } from '../access/access.module';
import { GlobalSettingsModule } from '../global-settings/global-settings.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionLoggerModule } from '../session-logger/session-logger.module';
import { SessionGateway } from './session.gateway';
import { SessionRoomNotifier } from './session-room.notifier';
import { SessionRulesService } from './session-rules.service';
import { SessionsApiController } from './sessions-api.controller';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

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
    NotificationModule,
    GlobalSettingsModule,
  ],
  controllers: [SessionsController, SessionsApiController],
  providers: [SessionsService, SessionGateway, SessionRoomNotifier, SessionRulesService],
  exports: [SessionRulesService],
})
export class SessionsModule {}
