import { Audit } from '../audit-log/audit.decorator';
import { Controller, Delete, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { Roles } from '@prisma/client';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { SessionsService } from './sessions.service';

@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsApiController {
  constructor(private readonly sessionsService: SessionsService) { }

  @Get('active/mine')
  getMyActiveSessions(@Req() req) {
    return this.sessionsService.getActiveSessionsForUser(req.user.id);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin, Roles.User)
  @Get(':auctionAuthId')
  @ApiQuery({ name: 'auctionAuthId', required: false, type: String })
  getSessions(@Param('auctionAuthId') auctionAuthId: string, @Req() req) {
    return this.sessionsService.getSessions(auctionAuthId, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Audit('session.terminate', 'Примусово завершено сесію {params.id}')
  @Delete(':id')
  finish(@Param('id') id: string, @Req() req) {
    return this.sessionsService.terminateSession(id, req.user.id);
  }
}