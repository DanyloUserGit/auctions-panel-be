import { Controller, Get, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) { }

    @Get('settings')
    async getMySettings(@Req() req) {
        return this.notificationService.getUserSettings(req.user.id);
    }

    @Patch('settings')
    async updateMySettings(
        @Req() req,
        @Body() body: { typeId: string; isEnabled?: boolean; channels?: string[] }
    ) {
        return this.notificationService.updateSettings(req.user.id, body.typeId, {
            isEnabled: body.isEnabled,
            channels: body.channels
        });
    }
}