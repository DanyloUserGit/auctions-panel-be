import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { NotificationChannel, NotificationConfigType, Prisma, Roles } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationGateway } from './notification.gateway';


@Injectable()
export class NotificationService {
    constructor(
        private prisma: PrismaService,
        private mailService: MailService,
        private readonly gateway: NotificationGateway
    ) { }
    private getDefaultValue(setting: Prisma.JsonValue | null): number {
        if (
            setting &&
            typeof setting === 'object' &&
            !Array.isArray(setting) &&
            'default' in setting
        ) {
            return Number(setting.default);
        }

        return 0;
    }

    /**
     * Користувач належить щонайбільше одній групі (User.userGroupId),
     * тож обов'язковість перевіряється відносно саме цієї групи.
     */
    private async getMandatoryTypeIdsForUser(userId: string): Promise<Set<string>> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { userGroupId: true }
        });

        if (!user?.userGroupId) {
            return new Set();
        }

        const requirements = await this.prisma.groupNotificationRequirement.findMany({
            where: {
                groupId: user.userGroupId,
                isMandatory: true
            },
            select: { notificationTypeId: true }
        });

        return new Set(requirements.map(r => r.notificationTypeId));
    }

    private async isMandatoryForUser(userId: string, typeId: string): Promise<boolean> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { userGroupId: true }
        });

        if (!user?.userGroupId) {
            return false;
        }

        const requirement = await this.prisma.groupNotificationRequirement.findFirst({
            where: {
                groupId: user.userGroupId,
                notificationTypeId: typeId,
                isMandatory: true
            }
        });

        return !!requirement;
    }

    async getUserSettings(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            throw new UnauthorizedException("Користувача не знайдено");
        }

        const [settings, mandatoryTypeIds] = await Promise.all([
            this.prisma.userNotificationSetting.findMany({
                where: {
                    userId,
                    notificationType: {
                        configType: 'Configurable'
                    }
                },
                include: {
                    notificationType: true
                }
            }),
            this.getMandatoryTypeIdsForUser(userId)
        ]);

        return settings.map(setting => ({
            ...setting,
            isMandatory: mandatoryTypeIds.has(setting.notificationTypeId)
        }));
    }
    private async notifyUser(
        userId: string,
        typeName: string,
        content: {
            subject: string;
            body: string;
        },
        sendEmail = true
    ) {

        const setting = await this.prisma.userNotificationSetting.findFirst({
            where: {
                userId,
                notificationType: {
                    name: typeName
                }
            },
            include: {
                user: true
            }
        });

        if (!setting || !setting.isEnabled) {
            return;
        }

        if (setting.channels.includes(NotificationChannel.InApp)) {

            const notification = await this.prisma.notification.create({
                data: {
                    userId,
                    type: typeName,
                    message: content.body
                }
            });

            this.gateway.sendToUser(userId, notification);
        }

        if (
            sendEmail &&
            setting.channels.includes(NotificationChannel.Email) &&
            setting.user.email
        ) {
            await this.mailService.send(
                setting.user.email,
                content.subject,
                content.body
            );
        }

        // Telegram
        if (setting.channels.includes(NotificationChannel.Telegram) && setting.user.telegramChatId) {
            // TODO: Розкоментувати після додавання TelegramService
            // await this.telegramService.sendMessage(setting.user.telegramChatId, content.body);
        }

        // Viber
        if (setting.channels.includes(NotificationChannel.Viber) && setting.user.viberId) {
            // TODO: Розкоментувати після додавання ViberService
            // await this.viberService.sendMessage(setting.user.viberId, content.body);
        }
    }
    private async sendSystemNotification(
        userId: string,
        type: string,
        content: {
            subject: string;
            body: string;
        }
    ) {

        const user = await this.prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return;
        }

        const notification = await this.prisma.notification.create({
            data: {
                userId,
                type,
                message: content.body
            }
        });

        this.gateway.sendToUser(userId, notification);

        if (user.email) {
            await this.mailService.send(
                user.email,
                content.subject,
                content.body
            );
        }
    }
    async notify(
        userId: string,
        typeName: string,
        content: {
            subject: string;
            body: string;
        },
        sendEmail = true
    ) {

        const type = await this.prisma.notificationType.findUnique({
            where: {
                name: typeName
            }
        });

        if (!type) {
            return;
        }

        if (type.configType === 'Configurable') {
            return this.notifyUser(userId, typeName, content, sendEmail);
        }

        const users = await this.prisma.user.findMany({
            where: {
                role: {
                    in: type.roles
                }
            },
            select: {
                id: true
            }
        });

        await Promise.all(
            users.map(u =>
                this.sendSystemNotification(
                    u.id,
                    typeName,
                    content
                )
            )
        );
    }

    async updateSettings(
        userId: string,
        typeId: string,
        updateDto: {
            value?: number;
            isEnabled?: boolean;
            channels?: NotificationChannel[];
        }
    ) {

        const type = await this.prisma.notificationType.findUnique({
            where: { id: typeId }
        });

        if (!type) {
            throw new BadRequestException("Тип сповіщення не знайдено");
        }

        if (type.configType !== 'Configurable') {
            throw new BadRequestException("Цей тип сповіщень не налаштовується.");
        }

        // Якщо користувач намагається вимкнути обов'язкове (для його групи) сповіщення - забороняємо
        if (updateDto.isEnabled === false) {
            const isMandatory = await this.isMandatoryForUser(userId, typeId);
            if (isMandatory) {
                throw new BadRequestException("Це сповіщення є обов'язковим для вашої групи і не може бути вимкнене");
            }
        }

        // Валідація користувацького значення (наприклад, "за скільки часу нагадати про завершення аукціону")
        if (updateDto.value !== undefined) {
            const setting = type.setting as { min?: number; max?: number } | null;
            if (setting && typeof setting === 'object') {
                if (setting.min !== undefined && updateDto.value < setting.min) {
                    throw new BadRequestException(`Значення не може бути меншим за ${setting.min}`);
                }
                if (setting.max !== undefined && updateDto.value > setting.max) {
                    throw new BadRequestException(`Значення не може бути більшим за ${setting.max}`);
                }
            }
        }

        return this.prisma.userNotificationSetting.update({
            where: {
                userId_notificationTypeId: {
                    userId,
                    notificationTypeId: typeId
                }
            },
            data: updateDto,
            include: {
                notificationType: true
            }
        });
    }
    async getNotifications(userId: string, page: number = 1, limit: number = 20) {
        const skip = (page - 1) * limit;
        const [data, total] = await Promise.all([
            this.prisma.notification.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.notification.count({ where: { userId } })
        ]);

        const unreadCount = await this.prisma.notification.count({
            where: { userId, isRead: false }
        });

        return { data, total, page, limit, unreadCount };
    }

    async markAsRead(userId: string, notificationId: string) {
        const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });

        if (!notification || notification.userId !== userId) {
            throw new ForbiddenException("Ви не можете змінити це сповіщення");
        }

        return this.prisma.notification.update({
            where: { id: notificationId },
            data: { isRead: true }
        });
    }

    async initializeDefaultSettings(userId: string) {
        const types = await this.prisma.notificationType.findMany({
            where: {
                configType: 'Configurable'
            }
        });
        const existingSettings = await this.prisma.userNotificationSetting.findMany({ where: { userId } });
        const existingTypeIds = existingSettings.map(s => s.notificationTypeId);

        const typesToCreate = types.filter(t => !existingTypeIds.includes(t.id));

        if (typesToCreate.length > 0) {
            await this.prisma.userNotificationSetting.createMany({
                data: typesToCreate.map(t => ({
                    userId,
                    notificationTypeId: t.id,
                    value: this.getDefaultValue(t.setting),
                    isEnabled: true,
                    channels: [NotificationChannel.InApp]
                }))
            });
        }
        return { message: "Налаштування ініціалізовано" };
    }

    async setGroupMandatoryRequirement(adminUserId: string, groupId: string, typeId: string, isMandatory: boolean) {
        const group = await this.prisma.userGroup.findUnique({ where: { id: groupId } });

        if (!group || group.AdminId !== adminUserId) {
            throw new ForbiddenException("Тільки адміністратор групи може змінювати ці налаштування");
        }

        const type = await this.prisma.notificationType.findUnique({ where: { id: typeId } });
        if (!type || type.configType !== 'Configurable') {
            throw new BadRequestException("Обов'язковим можна зробити лише налаштовуваний тип сповіщення");
        }

        return this.prisma.groupNotificationRequirement.upsert({
            where: { groupId_notificationTypeId: { groupId, notificationTypeId: typeId } },
            update: { isMandatory },
            create: { groupId, notificationTypeId: typeId, isMandatory }
        });
    }

    /**
     * Список усіх налаштовуваних типів сповіщень для групи разом з поточним
     * статусом isMandatory - для екрану адміністрування групи.
     */
    async getGroupRequirements(adminUserId: string, groupId: string) {
        const group = await this.prisma.userGroup.findUnique({ where: { id: groupId } });

        if (!group || group.AdminId !== adminUserId) {
            throw new ForbiddenException("Тільки адміністратор групи може переглядати ці налаштування");
        }

        const [types, requirements] = await Promise.all([
            this.prisma.notificationType.findMany({ where: { configType: 'Configurable' } }),
            this.prisma.groupNotificationRequirement.findMany({ where: { groupId } })
        ]);

        const requirementByType = new Map(requirements.map(r => [r.notificationTypeId, r.isMandatory]));

        return types.map(t => ({
            typeId: t.id,
            name: t.name,
            description: t.description,
            isMandatory: requirementByType.get(t.id) ?? false
        }));
    }

    /**
     * Групи, де поточний користувач є адміністратором. AdminId унікальний
     * на UserGroup, тож користувач керує щонайбільше однією групою -
     * але для зручності фронтенду (селектор) повертаємо масив.
     */
    async getMyAdminGroups(userId: string) {
        return this.prisma.userGroup.findMany({
            where: { AdminId: userId },
            select: { id: true, name: true }
        });
    }

    async seedNotificationTypes() {
        const types = [
            {
                name: 'AUCTION_ENDED',
                description: 'Сповіщення про завершення аукціону',
                roles: [Roles.Admin, Roles.SuperAdmin, Roles.User],
                configType: NotificationConfigType.Configurable,
                setting: {
                    min: 60,
                    max: 172800,
                    default: 3600
                }
            },
            {
                name: 'WORKER_ERROR',
                description: 'Критичні помилки воркерів',
                roles: [Roles.SuperAdmin],
                configType: NotificationConfigType.System
            },
            {
                name: 'ADDED_TO_GROUP',
                description: 'Додавання користувача до групи',
                roles: [Roles.Admin],
                configType: NotificationConfigType.System
            }
        ];

        let processedCount = 0;

        for (const type of types) {
            await this.prisma.notificationType.upsert({
                where: { name: type.name },
                create: {
                    name: type.name,
                    description: type.description,
                    roles: type.roles,
                    configType: type.configType,
                    setting: type.setting ?? undefined,
                },
                update: {
                    description: type.description,
                    roles: type.roles,
                    configType: type.configType,
                    setting: type.setting ?? undefined,
                },
            });
            processedCount++;
        }

        return {
            success: true,
            message: `Успішно додано або оновлено ${processedCount} типів сповіщень.`
        };
    }
}