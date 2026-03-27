import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationService } from './notification.service';

@Controller()
export class NotificationMicroController {
    constructor(private readonly notificationService: NotificationService) { }

    @EventPattern('notification.send')
    async handleSendNotification(@Payload() data: CreateNotificationDto) {
        try {
            await this.notificationService.notify(
                data.userId,
                data.typeName,
                data.content,
                data.sendEmail
            );
        } catch (error) {
            console.error(`Failed to process notification for user ${data.userId}:`, error.message);
        }
    }
}