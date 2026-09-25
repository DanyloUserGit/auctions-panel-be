import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { NotificationChannel, NotificationConfigType, Prisma, Roles } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { managedGroupIdOf, managedGroupWhere } from '../users/managed-group';
import { NotificationGateway } from './notification.gateway';


@Injectable()
export class NotificationService implements OnModuleInit {
    private readonly logger = new Logger(NotificationService.name);

    constructor(
        private prisma: PrismaService,
        private mailService: MailService,
        private readonly gateway: NotificationGateway
    ) { }
    // Типи сповіщень завжди є в базі (раніше їх створював лише ручний виклик /notifications/seed).
    async onModuleInit() {
        await this.seedNotificationTypes().catch((error) => this.logger.error('Не вдалося засіяти типи сповіщень', error));
    }

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

        // Налаштування для типів, що з'явилися після створення користувача.
        await this.initializeDefaultSettings(userId);

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
    // Чи користувач зараз у системі (відкрита вкладка панелі). Email потрібен лише офлайн-користувачам (ТЗ 15).
    private async isOnline(userId: string) {
        try {
            return (await this.gateway.server.in(userId).fetchSockets()).length > 0;
        } catch {
            return false;
        }
    }

    // Збій пошти не повинен ламати основну дію (створення групи, завершення сесії тощо).
    private async sendEmail(email: string, subject: string, body: string) {
        try {
            await this.mailService.send(email, subject, body);
        } catch (error) {
            this.logger.error(`Не вдалося надіслати email ${email}`, error as Error);
        }
    }

    private async deliver(
        user: { id: string; email: string },
        typeName: string,
        content: { subject: string; body: string },
        channels: NotificationChannel[],
    ) {
        if (channels.includes(NotificationChannel.InApp)) {
            const notification = await this.prisma.notification.create({
                data: { userId: user.id, type: typeName, message: content.body },
            });
            this.gateway.sendToUser(user.id, notification);
        }
        if (channels.includes(NotificationChannel.Email) && user.email && !(await this.isOnline(user.id))) {
            await this.sendEmail(user.email, content.subject, content.body);
        }
    }

    // Налаштовуване сповіщення: за налаштуваннями користувача (увімкнено, канали).
    private async notifyUser(userId: string, typeName: string, content: { subject: string; body: string }) {
        const setting = await this.prisma.userNotificationSetting.findFirst({
            where: { userId, notificationType: { name: typeName } },
            include: { user: { select: { id: true, email: true } } },
        });
        if (!setting || !setting.isEnabled) return;
        await this.deliver(setting.user, typeName, content, setting.channels);
    }

    // Системне сповіщення конкретним отримувачам: у кабінеті завжди, email - якщо отримувач не в системі.
    async notifyUsers(userIds: string[], typeName: string, content: { subject: string; body: string }) {
        const users = await this.prisma.user.findMany({
            where: { id: { in: [...new Set(userIds)] } },
            select: { id: true, email: true },
        });
        await Promise.all(
            users.map((user) => this.deliver(user, typeName, content, [NotificationChannel.InApp, NotificationChannel.Email])),
        );
    }

    // Налаштовуваний тип - одному користувачу за його налаштуваннями; системний - цьому користувачу.
    async notify(userId: string, typeName: string, content: { subject: string; body: string }) {
        const type = await this.prisma.notificationType.findUnique({ where: { name: typeName } });
        if (!type) return;

        if (type.configType === NotificationConfigType.Configurable) {
            return this.notifyUser(userId, typeName, content);
        }
        return this.notifyUsers([userId], typeName, content);
    }

    // Критичні помилки воркерів і сесій - усім Super Admin (ТЗ 3, 15).
    async notifySuperAdmins(typeName: string, content: { subject: string; body: string }) {
        const admins = await this.prisma.user.findMany({
            where: { role: Roles.SuperAdmin, isBlocked: false },
            select: { id: true },
        });
        await this.notifyUsers(admins.map((a) => a.id), typeName, content);
    }

    // Користувача додано до групи - повідомляємо адміністратора саме цієї групи (ТЗ 3, 15).
    async notifyGroupAdminAboutNewMember(groupId: string, memberIds: string[]) {
        if (memberIds.length === 0) return;
        const group = await this.prisma.userGroup.findUnique({ where: { id: groupId }, select: { name: true, AdminId: true } });
        if (!group?.AdminId) return;

        const members = await this.prisma.user.findMany({
            where: { id: { in: memberIds }, NOT: { id: group.AdminId } },
            select: { firstName: true, lastName: true, email: true },
        });
        if (members.length === 0) return;
        const names = members.map((m) => `${m.firstName} ${m.lastName} (${m.email})`).join(', ');
        await this.notifyUsers([group.AdminId], 'ADDED_TO_GROUP', {
            subject: 'Новий користувач у вашій групі',
            body: `До групи «${group.name}» додано: ${names}.`,
        });
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

        if (!group || (await managedGroupIdOf(this.prisma, adminUserId)) !== group.id) {
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

        if (!group || (await managedGroupIdOf(this.prisma, adminUserId)) !== group.id) {
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
            where: managedGroupWhere(userId),
            select: { id: true, name: true }
        });
    }

    async seedNotificationTypes() {
        const types = [
            {
                name: 'AUCTION_ENDED',
                description: 'Нагадування про завершення аукціону (за скільки секунд до кінця нагадати)',
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
            },
            {
                name: 'SESSION_ENDED',
                description: 'Сесію завершив адміністратор, таймаут або збій',
                roles: [Roles.Admin, Roles.SuperAdmin, Roles.User],
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