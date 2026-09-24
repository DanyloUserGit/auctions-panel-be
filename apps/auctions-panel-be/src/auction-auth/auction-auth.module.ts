import { Module } from '@nestjs/common';
import { AuctionAuthController } from './auction-auth.controller';
import { AuctionAuthService } from './auction-auth.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessModule } from '../access/access.module';

@Module({
  imports: [PrismaModule, AccessModule],
  controllers: [AuctionAuthController],
  providers: [AuctionAuthService],
})
export class AuctionAuthModule {}
