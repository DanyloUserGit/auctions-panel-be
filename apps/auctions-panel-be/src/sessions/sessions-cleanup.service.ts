import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SessionsService } from './sessions.service';

@Injectable()
export class TokenCleanupService {
    constructor(private sessionsService: SessionsService) { }

    @Cron('*/2 * * * *')
    async handleCleanup() {
        await this.sessionsService.terminateExpiredSessions();
    }
}
