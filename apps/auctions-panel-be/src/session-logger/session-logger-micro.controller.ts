import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { SessionLoggerService } from './session-logger.service';
import type { CreateLogDto } from './dto/session-log.dto';
import { SessionEventType } from '@prisma/client';

@Controller()
export class SessionLoggerMicroController {
    constructor(private readonly sessionLoggerService: SessionLoggerService) { }
    @EventPattern('session.log.event')
    async handleLogEvent(@Payload() dto: CreateLogDto) {
        await this.sessionLoggerService.logEvent(dto);
    }

    @EventPattern('session.log.incident')
    async handleLogIncident(
        @Payload() data: {
            sessionId: string;
            message: string;
            eventType: SessionEventType;
            details?: any
        }
    ) {
        await this.sessionLoggerService.logIncident(
            data.sessionId,
            data.message,
            data.eventType,
            data.details
        );
    }
}