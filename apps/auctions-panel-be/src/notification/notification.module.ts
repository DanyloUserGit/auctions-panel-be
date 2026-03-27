import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { NotificationService } from './notification.service';
import { NotificationMicroController } from './notification-micro.controller';

@Module({
  imports: [PrismaModule, MailModule],
  providers: [NotificationService, NotificationGateway],
  controllers: [NotificationController, NotificationMicroController],
  exports: [NotificationService]
})
export class NotificationModule { }
