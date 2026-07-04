import {
    Controller,
    ForbiddenException,
    Get,
    Query,
    Request,
    UseGuards
} from '@nestjs/common';
import { AuctionGroup, Roles, User } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import type { LogFilterDto } from './dto/session-log.dto';
import { SessionLoggerService } from './session-logger.service';

type RequestUser = User & { managedGroup: AuctionGroup | null };

@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin, Roles.Admin)
@Controller('dispatcher/logs')
export class SessionLoggerController {
    constructor(private readonly loggerService: SessionLoggerService) { }

    /**
     * Визначає, до якої групи обмежити вибірку для поточного користувача.
     * - SuperAdmin: без обмежень (повертає undefined).
     * - Admin без managedGroup: доступ заборонено.
     * - Admin з managedGroup: обмеження по його групі (перезаписує будь-який
     *   auctionGroupId, який міг прийти у query-параметрах).
     */
    private resolveGroupScope(user: RequestUser): string | undefined {
        if (!user.managedGroup && user.role !== Roles.SuperAdmin) {
            throw new ForbiddenException("Ви не керуєте жодною групою");
        }

        return user.role !== Roles.SuperAdmin
            ? (user.managedGroup?.id ?? undefined)
            : undefined;
    }

    private applyGroupScope(filters: LogFilterDto, user: RequestUser): void {
        const groupId = this.resolveGroupScope(user);
        if (groupId !== undefined) {
            filters.auctionGroupId = groupId;
        }
    }

    @Get()
    async getLogs(
        @Query() filters: LogFilterDto,
        @Request() req: { user: RequestUser },
    ) {
        this.applyGroupScope(filters, req.user);

        if (typeof filters.isIncident === 'string') {
            filters.isIncident = filters.isIncident === 'true';
        }

        return this.loggerService.getSessionLogs(filters);
    }

    @Get('forbidden')
    async getForbiddenActions(
        @Query() filters: LogFilterDto,
        @Request() req: { user: RequestUser },
    ) {
        this.applyGroupScope(filters, req.user);

        return this.loggerService.getForbiddenActionsJournal(filters);
    }

    @Get('incidents')
    async getIncidents(
        @Query() filters: LogFilterDto,
        @Request() req: { user: RequestUser },
    ) {
        this.applyGroupScope(filters, req.user);

        return this.loggerService.getIncidentsJournal(filters);
    }
}