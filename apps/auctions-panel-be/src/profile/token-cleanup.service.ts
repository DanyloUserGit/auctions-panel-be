import { Injectable } from "@nestjs/common";
import { ProfileService } from "./profile.service";
import { Cron, CronExpression } from "@nestjs/schedule";

@Injectable()
export class TokenCleanupService {
  constructor(private profileService: ProfileService) {}

  @Cron(CronExpression.EVERY_HOUR) 
  async handleCleanup() {
    const result = await this.profileService.cleanExpiredTokens();
  }
}