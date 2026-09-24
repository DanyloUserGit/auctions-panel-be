import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserGroupsController } from './user-groups.controller';
import { UserGroupsService } from './user-groups.service';

@Module({
  imports: [PrismaModule, NotificationModule, AccessModule],
  providers: [UserGroupsService],
  controllers: [UserGroupsController]
})
export class UserGroupsModule { }
