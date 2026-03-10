import {
    Controller,
    ForbiddenException,
    Get,
    Query,
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

        if (!user.auctionGroupId) {
            if (!(user.role == Roles.SuperAdmin))
                throw new ForbiddenException("Ви не керуєте жодною групою");
        }

        let auctionGroupId: string | undefined = user.auctionGroupId ?? undefined;

        if (user.role !== Roles.SuperAdmin) {
            filters.auctionGroupId = auctionGroupId;
        }

        if (typeof filters.isIncident === 'string') {
            filters.isIncident = filters.isIncident === 'true';
        }

        return this.loggerService.getSessionLogs(filters);
    }

    @Get('forbidden')
    async getForbiddenActions(
        @Query('skip') skip: string,
        @Query('take') take: string,
        @Request() req: any,
    ) {
        const user = req.user;
        const auctionGroupId = user.role !== Roles.SuperAdmin ? user.auctionGroupId : undefined;

        return this.loggerService.getForbiddenActionsJournal(
            auctionGroupId,
            skip ? Number(skip) : 0,
            take ? Number(take) : 50
        );
    }

    @Get('incidents')
    async getIncidents(
        @Query('skip') skip: string,
        @Query('take') take: string,
        @Request() req: any,
    ) {
        const user = req.user;
        const auctionGroupId = user.role !== Roles.SuperAdmin ? user.auctionGroupId : undefined;

        return this.loggerService.getIncidentsJournal(
            auctionGroupId,
            skip ? Number(skip) : 0,
            take ? Number(take) : 50
        );
    }
}