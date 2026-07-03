import { ForbiddenException, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Roles } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionLoggerService } from '../session-logger/session-logger.service'; // Ваш сервіс логів
import { SessionFilterDto } from './dto/session-filter.dto';

@Injectable()
export class SessionDispatcherService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly loggerService: SessionLoggerService,
    ) { }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async cleanupOldSessions() {
        const retentionSetting = await this.prisma.systemSetting.findUnique({
            where: { key: 'SESSION_RETENTION_DAYS' },
        });

        const retentionDays = retentionSetting ? parseInt(retentionSetting.value, 10) : 7;

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        await this.prisma.session.deleteMany({
            where: {
                isActive: false,
                endedAt: {
                    lt: cutoffDate,
                },
            },
        });

    }

    async getSessions(filters: SessionFilterDto, userRole: Roles, userGroupId?: string) {
        const where: any = {};

        if (filters.isActive !== undefined) {
            where.isActive = filters.isActive;
        }

        if (userRole !== Roles.SuperAdmin) {
            if (!userGroupId) {
                throw new ForbiddenException('Користувач не прив\'язаний до жодної групи');
            }
            where.auctionGroupId = userGroupId;
        } else if (filters.auctionGroupId) {
            where.auctionGroupId = filters.auctionGroupId;
        }

        if (filters.userId) {
            where.users = { some: { id: filters.userId } };
        }
        if (filters.auctionId) {
            where.auctionId = filters.auctionId;
        }
        if (filters.startDate || filters.endDate) {
            where.createdAt = {};
            if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
            if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
        }

        return this.prisma.session.findMany({
            where,
            skip: filters.skip ? Number(filters.skip) : 0,
            take: filters.take ? Number(filters.take) : 50,
            orderBy: { createdAt: 'desc' },
            include: {
                auction: { select: { id: true, title: true } },
                users: { select: { id: true, email: true, firstName: true, lastName: true } },
                endedBy: { select: { id: true, email: true } },
            },
        });
    }

}