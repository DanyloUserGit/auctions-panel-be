import {
    Controller,
    Get,
    Post,
    Param,
    Query,
    UseGuards,
    Request,
    ParseUUIDPipe,
    ForbiddenException
} from '@nestjs/common';
import { SessionDispatcherService } from './session-dispatcher.service';
import type { SessionFilterDto } from './dto/session-filter.dto';
import { Roles, User } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';


@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin, Roles.Admin)
@Controller('dispatcher/sessions')
export class SessionDispatcherController {
    constructor(private readonly dispatcherService: SessionDispatcherService) { }

    @Get()
    async getSessions(
        @Query() filters: SessionFilterDto,
        @Request() req: { user: User },
    ) {
        const user = req.user;

        if (typeof filters.isActive === 'string') {
            filters.isActive = filters.isActive === 'true';
        }


        if (!user.auctionGroupId) {
            if (!(user.role == Roles.SuperAdmin))
                throw new ForbiddenException("Ви не керуєте жодною групою");
        }

        let auctionGroupId: string | undefined = user.auctionGroupId ?? undefined;

        return this.dispatcherService.getSessions(
            filters,
            user.role,
            auctionGroupId
        );
    }

}