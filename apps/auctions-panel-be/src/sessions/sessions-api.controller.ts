import { Controller, Delete, Get, Param, Req } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsApiController {
  constructor(private readonly sessionsService: SessionsService) { }

  @Get('active/mine')
  getMyActiveSessions(@Req() req) {
    return this.sessionsService.getActiveSessionsForUser(req.user.id);
  }

  @Get(':auctionAuthId')
  @ApiQuery({ name: 'auctionAuthId', required: false, type: String })
  getSessions(@Param('auctionAuthId') auctionAuthId: string) {
    return this.sessionsService.getSessions(auctionAuthId);
  }

  @Delete(':id')
  finish(@Param('id') id: string, @Req() req) {
    return this.sessionsService.terminateSession(id, req.user.id);
  }
}