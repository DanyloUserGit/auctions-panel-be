import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuctionAuthController } from './auction-auth.controller';
import { AuctionAuthService } from './auction-auth.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuctionAuthController],
  providers: [AuctionAuthService],
})
export class AuctionAuthModule {}
