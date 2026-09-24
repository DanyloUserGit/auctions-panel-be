import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { NotificationService } from './notification.service';
import { NotificationMicroController } from './notification-micro.controller';

@Module({
  // Секрет передається явно у NotificationGateway (JWT_SECRET), як і в JwtStrategy.
  imports: [PrismaModule, MailModule, JwtModule.register({})],
  providers: [NotificationService, NotificationGateway],
  controllers: [NotificationController, NotificationMicroController],
  exports: [NotificationService]
})
export class NotificationModule { }
