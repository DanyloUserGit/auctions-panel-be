import {
    Controller,
    ForbiddenException,
    Get,
    Query,
    Req,
    Request,
    UseGuards
} from '@nestjs/common';
import { Roles, User } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import type { LogFilterDto } from './dto/session-log.dto';
import { SessionLoggerService } from './session-logger.service';

@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin, Roles.Admin)
@Controller('dispatcher/logs')
export class SessionLoggerController {
    constructor(private readonly loggerService: SessionLoggerService) { }

    @Get()
    async getLogs(
        @Query() filters: LogFilterDto,
        @Request() req: { user: User },
    ) {
        const user = req.user;

        if (!user.auctionGroupId && user.role !== Roles.SuperAdmin) {
            throw new ForbiddenException("Ви не керуєте жодною групою");
        }

        if (user.role !== Roles.SuperAdmin) {
            filters.auctionGroupId = user.auctionGroupId ?? undefined;
        }

        if (typeof filters.isIncident === 'string') {
            filters.isIncident = filters.isIncident === 'true';
        }

        return this.loggerService.getSessionLogs(filters);
    }

    @Get('forbidden')
    async getForbiddenActions(
        @Query() filters: LogFilterDto,
        @Req() req: { user: User },
    ) {
        const user = req.user;
        
        if (!user.auctionGroupId && user.role !== Roles.SuperAdmin) {
            throw new ForbiddenException("Ви не керуєте жодною групою");
        }

        if (user.role !== Roles.SuperAdmin) {
            filters.auctionGroupId = user.auctionGroupId ?? undefined;
        }

        return this.loggerService.getForbiddenActionsJournal(filters);
    }

    @Get('incidents')
    async getIncidents(
        @Query() filters: LogFilterDto,
        @Request() req: { user: User },
    ) {
        const user = req.user;
        
        if (!user.auctionGroupId && user.role !== Roles.SuperAdmin) {
            throw new ForbiddenException("Ви не керуєте жодною групою");
        }

        if (user.role !== Roles.SuperAdmin) {
            filters.auctionGroupId = user.auctionGroupId ?? undefined;
        }

        return this.loggerService.getIncidentsJournal(filters);
    }
}