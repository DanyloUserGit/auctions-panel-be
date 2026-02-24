import { Module } from '@nestjs/common';
import { AuctionGroupsService } from './auction-groups.service';
import { AuctionGroupsController } from './auction-groups.controller';

@Module({
  controllers: [AuctionGroupsController],
  providers: [AuctionGroupsService],
})
export class AuctionGroupsModule {}
