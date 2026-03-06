import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { Public } from '../decorators/public.decorator';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) { }

    @Get('settings')
    async getMySettings(@Req() req) {
        return this.notificationService.getUserSettings(req.user.id);
    }

    @Public()
    @Post('seed')
    async seedTypes() {
        return this.notificationService.seedNotificationTypes();
    }

    @Patch('settings')
    async updateMySettings(
        @Req() req,
        @Body() body: { typeId: string; isEnabled?: boolean; channels?: NotificationChannel[] }
    ) {
        return this.notificationService.updateSettings(req.user.id, body.typeId, {
            isEnabled: body.isEnabled,
            channels: body.channels
        });
    }
    @Get()
    async getNotifications(
        @Req() req,
        @Query('page') page: string,
        @Query('limit') limit: string
    ) {
        return this.notificationService.getNotifications(req.user.id, Number(page) || 1, Number(limit) || 20);
    }

    @Patch(':id/read')
    async markAsRead(@Req() req, @Param('id') id: string) {
        return this.notificationService.markAsRead(req.user.id, id);
    }
    @Patch('group/:groupId/requirements')
    async setGroupRequirement(
        @Req() req,
        @Param('groupId') groupId: string,
        @Body() body: { typeId: string, isMandatory: boolean }
    ) {
        return this.notificationService.setGroupMandatoryRequirement(req.user.id, groupId, body.typeId, body.isMandatory);
    }
}