import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
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

    async notify(userId: string, typeName: string, content: { subject: string; body: string }) {
        const setting = await this.prisma.userNotificationSetting.findFirst({
            where: {
                userId,
                notificationType: { name: typeName }
            },
            include: {
                user: true,
                notificationType: true
            }
        });

        if (!setting) return;

        const groupRequirement = await this.prisma.groupNotificationRequirement.findFirst({
            where: {
                notificationTypeId: setting.notificationTypeId,
                groupId: setting.user.auctionGroupId || undefined
            }
        });

        const isMandatory = groupRequirement?.isMandatory || false;

        if (setting.isEnabled || isMandatory) {
            if (setting.channels.includes('InApp')) {
                const newNotif = await this.prisma.notification.create({
                    data: {
                        userId,
                        type: typeName,
                        message: content.body,
                    },
                });

                this.gateway.sendToUser(userId, {
                    id: newNotif.id,
                    type: typeName,
                    message: content.body,
                    createdAt: newNotif.createdAt
                });
            }

            if (setting.channels.includes('Email') && setting.user.email) {
                await this.mailService.send(setting.user.email, content.subject, content.body);
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
}