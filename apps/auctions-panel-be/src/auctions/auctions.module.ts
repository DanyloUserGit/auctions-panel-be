import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, AccessModule],
  controllers: [AuctionsController],
  providers: [AuctionsService],
})
export class AuctionsModule {}
