import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationService } from './notification.service';

// Сповіщення від browser-worker. Помилки воркера - системні, лише для Super Admin (ТЗ 15).
@Controller()
export class NotificationMicroController {
    private readonly logger = new Logger(NotificationMicroController.name);

    constructor(private readonly notificationService: NotificationService) { }

    @EventPattern('notification.send')
    async handleSendNotification(@Payload() data: CreateNotificationDto) {
        try {
            if (data.typeName === 'WORKER_ERROR' || !data.userId) {
                await this.notificationService.notifySuperAdmins(data.typeName, data.content);
            } else {
                await this.notificationService.notify(data.userId, data.typeName, data.content);
            }
        } catch (error) {
            this.logger.error(`Не вдалося обробити сповіщення ${data.typeName}`, error as Error);
        }
    }
}
