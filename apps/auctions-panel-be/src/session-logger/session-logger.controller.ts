import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { LogFilterSchema } from './dto/session-log.dto';
import { SessionLoggerService } from './session-logger.service';

@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin, Roles.Admin)
@Controller('dispatcher/logs')
export class SessionLoggerController {
    constructor(private readonly loggerService: SessionLoggerService) { }

    @Get()
    getLogs(@Query() query: unknown, @Req() req) {
        return this.loggerService.getSessionLogs(LogFilterSchema.parse(query), req.user);
    }

    @Get('forbidden')
    getForbiddenActions(@Query() query: unknown, @Req() req) {
        return this.loggerService.getForbiddenActionsJournal(LogFilterSchema.parse(query), req.user);
    }

    @Get('incidents')
    getIncidents(@Query() query: unknown, @Req() req) {
        return this.loggerService.getIncidentsJournal(LogFilterSchema.parse(query), req.user);
    }
}
