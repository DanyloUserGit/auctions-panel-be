import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { NotificationChannel, Roles } from '@prisma/client';
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

    async getUserSettings(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { auctionGroup: true }
        });

        const settings = await this.prisma.userNotificationSetting.findMany({
            where: { userId },
            include: { notificationType: true }
        });

        if (!user) throw new UnauthorizedException("Користувача не знайдено");
        const groupRequirements = user.auctionGroupId
            ? await this.prisma.groupNotificationRequirement.findMany({
                where: { groupId: user.auctionGroupId }
            })
            : [];

        return settings.map(s => ({
            ...s,
            isMandatory: groupRequirements.find(r => r.notificationTypeId === s.notificationTypeId)?.isMandatory || false
        }));
    }

    async notify(userId: string, typeName: string, content: { subject: string; body: string }, sendEmail?: boolean) {
        const setting = await this.prisma.userNotificationSetting.findFirst({
            where: { userId, notificationType: { name: typeName } },
            include: { user: true, notificationType: true }
        });
        console.log("Setting: ", setting)
        if (!setting) return;
        console.log("Setting end")
        const groupRequirement = setting.user.auctionGroupId
            ? await this.prisma.groupNotificationRequirement.findFirst({
                where: { notificationTypeId: setting.notificationTypeId, groupId: setting.user.auctionGroupId }
            }) : null;

        const isMandatory = groupRequirement?.isMandatory || false;
            console.log("isMandatory")
        if (setting.isEnabled || isMandatory) {
            
            // In-App
            if (setting.channels.includes(NotificationChannel.InApp)) {
                console.log("IN-APP")
                const newNotif = await this.prisma.notification.create({
                    data: { userId, type: typeName, message: content.body },
                });
                const allSuperAdmins = await this.prisma.user.findMany({
                    where: { role: Roles.SuperAdmin }, select: {
                        id: true
                    }
                });
                const groups = await this.prisma.auctionGroup.findMany({
                    where: {
                        users: {
                            some: {
                                id: userId,
                            },
                        },
                    },
                    select: {
                        AdminId: true
                    }
                })
                const allUsers = [{ id: userId }, ...allSuperAdmins.filter((item)=>item.id!==userId), ...groups.filter((item)=>item.AdminId!==userId).map((group) => { return { id: group.AdminId } })].map((item) => item.id);
                console.log("allUsers: ", allUsers)
                allUsers.map((id) => {
                    if (id) {
                        setTimeout(() => {
                            this.gateway.sendToUser(id, {
                                id: newNotif.id,
                                type: typeName,
                                message: content.body,
                                createdAt: newNotif.createdAt
                            });
                            console.log(id, {
                                id: newNotif.id,
                                type: typeName,
                                message: content.body,
                                createdAt: newNotif.createdAt
                            })
                        }, 5000)
                    }
                })
            }

            // Email
            if (sendEmail && setting.channels.includes(NotificationChannel.Email) && setting.user.email) {
                await this.mailService.send(setting.user.email, content.subject, content.body);
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
    }

    async updateSettings(userId: string, typeId: string, updateDto: { isEnabled?: boolean; channels?: any[] }) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new UnauthorizedException("Користувача не знайдено");

        if (updateDto.isEnabled === false && user.auctionGroupId) {
            const mandatory = await this.prisma.groupNotificationRequirement.findFirst({
                where: { groupId: user.auctionGroupId, notificationTypeId: typeId, isMandatory: true }
            });
            if (mandatory) {
                throw new BadRequestException("Це сповіщення є обов'язковим для вашої групи");
            }
        }

        return this.prisma.userNotificationSetting.update({
            where: { userId_notificationTypeId: { userId, notificationTypeId: typeId } },
            data: updateDto
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
        const types = await this.prisma.notificationType.findMany();
        const existingSettings = await this.prisma.userNotificationSetting.findMany({ where: { userId } });
        const existingTypeIds = existingSettings.map(s => s.notificationTypeId);

        const typesToCreate = types.filter(t => !existingTypeIds.includes(t.id));

        if (typesToCreate.length > 0) {
            await this.prisma.userNotificationSetting.createMany({
                data: typesToCreate.map(t => ({
                    userId,
                    notificationTypeId: t.id,
                    isEnabled: true,
                    channels: [NotificationChannel.InApp]
                }))
            });
        }
        return { message: "Налаштування ініціалізовано" };
    }

    async setGroupMandatoryRequirement(adminUserId: string, groupId: string, typeId: string, isMandatory: boolean) {
        const group = await this.prisma.auctionGroup.findUnique({ where: { id: groupId } });

        if (!group || group.AdminId !== adminUserId) {
            throw new ForbiddenException("Тільки адміністратор групи може змінювати ці налаштування");
        }

        return this.prisma.groupNotificationRequirement.upsert({
            where: { groupId_notificationTypeId: { groupId, notificationTypeId: typeId } },
            update: { isMandatory },
            create: { groupId, notificationTypeId: typeId, isMandatory }
        });
    }
    async seedNotificationTypes() {
        const types = [
            { name: 'SESSION_STARTED', description: 'Сповіщення про успішний запуск сесії для аукціону' },
            { name: 'SESSION_EXPIRING', description: 'Попередження про те, що час активної сесії скоро закінчиться' },
            { name: 'AUCTION_ENDED', description: 'Сповіщення про завершення аукціону' },
            { name: 'ADDED_TO_GROUP', description: 'Сповіщення про додавання користувача до нової групи' },
            { name: 'WORKER_ERROR', description: 'Критичні сповіщення про помилки в роботі воркерів' },
            { name: 'USER_LOGED_IN', description: 'Користувач увійшов до системи' },
            { name: 'USER_LOGED_OUT', description: 'Користувач вийшов з системи' },
        ];

        let processedCount = 0;

        for (const type of types) {
            await this.prisma.notificationType.upsert({
                where: { name: type.name },
                update: { description: type.description },
                create: { name: type.name, description: type.description },
            });
            processedCount++;
        }

        return {
            success: true,
            message: `Успішно додано або оновлено ${processedCount} типів сповіщень.`
        };
    }
}