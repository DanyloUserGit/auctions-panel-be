import {
    Controller,
    ForbiddenException,
    Get,
    Query,
    Req,
    UseGuards
} from '@nestjs/common';
import { AuctionGroup, Roles, User } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import type { SessionFilterDto } from './dto/session-filter.dto';
import { SessionDispatcherService } from './session-dispatcher.service';

type RequestUser = User & { managedGroup: AuctionGroup | null };

@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin, Roles.Admin)
@Controller('dispatcher/sessions')
export class SessionDispatcherController {
    constructor(private readonly dispatcherService: SessionDispatcherService) { }
    private resolveGroupScope(user: RequestUser): string | undefined {
        if (!user.managedGroup && user.role !== Roles.SuperAdmin) {
            throw new ForbiddenException("Ви не керуєте жодною групою");
        }

        return user.role !== Roles.SuperAdmin
            ? (user.managedGroup?.id ?? undefined)
            : undefined;
    }

    @Get()
    async getSessions(
        @Query() filters: SessionFilterDto,
        @Req() req: { user: RequestUser },
    ) {
        const user = req.user;

        if (typeof filters.isActive === 'string') {
            filters.isActive = filters.isActive === 'true';
        }

        const auctionGroupId = this.resolveGroupScope(user);

        return this.dispatcherService.getSessions(
            filters,
            user.role,
            auctionGroupId
        );
    }

}