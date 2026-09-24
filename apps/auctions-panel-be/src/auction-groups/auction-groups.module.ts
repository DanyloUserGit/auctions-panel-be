import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuctionGroupsController } from './auction-groups.controller';
import { AuctionGroupsService } from './auction-groups.service';

@Module({
  imports: [PrismaModule, NotificationModule, AccessModule],
  controllers: [AuctionGroupsController],
  providers: [AuctionGroupsService],
})
export class AuctionGroupsModule { }
