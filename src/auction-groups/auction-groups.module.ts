import { Module } from '@nestjs/common';
import { AuctionGroupsService } from './auction-groups.service';
import { AuctionGroupsController } from './auction-groups.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuctionGroupsController],
  providers: [AuctionGroupsService],
})
export class AuctionGroupsModule {}
