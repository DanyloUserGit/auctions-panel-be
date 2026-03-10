import { Injectable } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class TokenCleanupService {
  constructor(private profileService: ProfileService) {}

  @Cron('*/2 * * * *')
  async handleCleanup() {
    const result = await this.profileService.cleanExpiredTokens();
  }
}
