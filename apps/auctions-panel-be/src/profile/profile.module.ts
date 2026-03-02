import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { TokenCleanupService } from './token-cleanup.service';

@Module({
  imports: [PrismaModule],
  providers: [ProfileService, TokenCleanupService],
  controllers: [ProfileController]
})
export class ProfileModule { }
