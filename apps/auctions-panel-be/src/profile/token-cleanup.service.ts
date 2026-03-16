import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProfileService } from './profile.service';

@Injectable()
export class TokenCleanupService {
  constructor(private profileService: ProfileService) { }

  @Cron('*/2 * * * *')
  async handleCleanup() {
    await this.profileService.cleanExpiredTokens();
  }
}
