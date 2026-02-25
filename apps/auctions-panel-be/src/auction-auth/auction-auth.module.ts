import { Module } from '@nestjs/common';
import { AuctionAuthController } from './auction-auth.controller';
import { AuctionAuthService } from './auction-auth.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuctionAuthController],
  providers: [AuctionAuthService],
})
export class AuctionAuthModule {}
