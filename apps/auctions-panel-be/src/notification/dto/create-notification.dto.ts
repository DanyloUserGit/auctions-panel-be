export class NotificationContentDto {
    subject: string;
    body: string;
}

export class CreateNotificationDto {
    userId: string;
    typeName: string;
    content: NotificationContentDto;
    sendEmail?: boolean;
}