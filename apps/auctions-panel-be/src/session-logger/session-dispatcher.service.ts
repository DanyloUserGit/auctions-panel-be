import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionLoggerService } from '../session-logger/session-logger.service'; // Ваш сервіс логів
import { SessionFilterDto } from './dto/session-filter.dto';
import { SessionEventType, Roles } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';

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

    // ==========================================
    // ОДЕРЖАННЯ СЕСІЙ (17.1 Активні / 17.2 Завершені)
    // ==========================================

    async getSessions(filters: SessionFilterDto, userRole: Roles, userGroupId?: string) {
        const where: any = {};

        // 1. Розділення на Активні (17.1) та Завершені (17.2)
        if (filters.isActive !== undefined) {
            where.isActive = filters.isActive;
        }

        // 2. Обмеження прав доступу (Role-Based Access Control)
        if (userRole !== Roles.SuperAdmin) {
            // Якщо це Admin (GroupAdmin), він бачить ТІЛЬКИ сесії своєї групи
            if (!userGroupId) {
                throw new ForbiddenException('Користувач не прив\'язаний до жодної групи');
            }
            where.auctionGroupId = userGroupId;
        } else if (filters.auctionGroupId) {
            // SuperAdmin може добровільно фільтрувати по групі
            where.auctionGroupId = filters.auctionGroupId;
        }

        // 3. Застосування інших фільтрів з UI
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

        // Виконання запиту з пагінацією та підтягуванням зв'язків
        return this.prisma.session.findMany({
            where,
            skip: filters.skip ? Number(filters.skip) : 0,
            take: filters.take ? Number(filters.take) : 50,
            orderBy: { createdAt: 'desc' },
            include: {
                auction: { select: { id: true, title: true } },
                users: { select: { id: true, email: true, firstName: true, lastName: true } },
                endedBy: { select: { id: true, email: true } }, // Щоб бачити, хто завершив
            },
        });
    }

    // ==========================================
    // УПРАВЛІННЯ СЕСІЯМИ (17.1)
    // ==========================================

    /**
     * Примусове завершення сесії адміністратором
     */
    async terminateSession(sessionId: string, adminId: string, adminRole: Roles, adminGroupId?: string) {
        // 1. Знаходимо сесію
        const session = await this.prisma.session.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            throw new NotFoundException('Сесію не знайдено');
        }

        if (!session.isActive) {
            throw new ForbiddenException('Ця сесія вже завершена');
        }

        // 2. Перевірка прав (чи може цей адмін завершити ЦЮ сесію)
        // Налаштування "хто може завершувати сесії" можна розширити тут
        if (adminRole !== Roles.SuperAdmin && session.auctionGroupId !== adminGroupId) {
            throw new ForbiddenException('У вас немає прав для завершення сесії іншої групи');
        }

        // 3. Оновлюємо статус сесії
        const updatedSession = await this.prisma.session.update({
            where: { id: sessionId },
            data: {
                isActive: false,
                endedAt: new Date(),
                endedById: adminId, // Фіксуємо, хто саме натиснув кнопку
            },
        });

        // 4. Записуємо лог про примусове завершення
        await this.loggerService.logEvent({
            sessionId: session.id,
            userId: adminId,
            eventType: SessionEventType.Other, // Або створіть окремий тип SessionTerminated
            severity: 'Warning',
            message: 'Сесія була примусово завершена адміністратором',
            isIncident: false,
        });

        // Тут також можна додати логіку для відправки сигналу на Worker, щоб він реально закрив з'єднання (WebSocket/Redis)

        return updatedSession;
    }
}