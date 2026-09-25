import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { SessionFilterSchema } from './dto/session-filter.dto';
import { SessionDispatcherService } from './session-dispatcher.service';

@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin, Roles.Admin)
@Controller('dispatcher/sessions')
export class SessionDispatcherController {
    constructor(private readonly dispatcherService: SessionDispatcherService) { }

    @Get()
    getSessions(@Query() query: unknown, @Req() req) {
        return this.dispatcherService.getSessions(SessionFilterSchema.parse(query), req.user);
    }
}
