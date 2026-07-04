import { Injectable } from '@nestjs/common';
import { SessionEventType, Prisma } from '@prisma/client';
import { CreateLogDto, LogFilterDto } from './dto/session-log.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionLoggerService {
    constructor(private readonly prisma: PrismaService) { }

    async logEvent(dto: CreateLogDto) {
        const user = await this.prisma.user.findFirst({ where: { id: dto.userId } });
        if(user && dto?.message && dto.message.includes(user.id)){
            dto.message = dto.message.replaceAll(user.id, `${user.firstName} ${user.lastName} (${user.email})`);
        }
        return this.prisma.sessionLog.create({
            data: {
                sessionId: dto.sessionId,
                userId: dto.userId,
                eventType: dto.eventType,
                severity: dto.severity || 'Info',
                message: dto.message,
                details: dto.details ? dto.details : Prisma.JsonNull,
                isIncident: dto.isIncident || false,
            },
        });
    }

    async logIncident(sessionId: string, message: string, eventType: SessionEventType, details?: any) {
        return this.logEvent({
            sessionId,
            eventType,
            severity: 'Critical',
            message,
            details,
            isIncident: true,
        });
    }

    async getSessionLogs(filters: LogFilterDto) {
        const where: Prisma.SessionLogWhereInput = {};

        // Базові фільтри
        if (filters.sessionId) where.sessionId = filters.sessionId;
        if (filters.eventType) where.eventType = filters.eventType;
        if (filters.isIncident !== undefined) where.isIncident = filters.isIncident;

        // Фільтр по конкретному користувачу (хто зробив дію)
        if (filters.userId) where.userId = filters.userId;

        // Фільтр по датах
        if (filters.startDate || filters.endDate) {
            where.createdAt = {};
            if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
            if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
        }

        // Пошук по тексту (повідомлення)
        if (filters.search) {
            where.message = {
                contains: filters.search,
                mode: 'insensitive',
            };
        }

        if (filters.auctionGroupId) {
            where.session = {
                auctionGroupId: filters.auctionGroupId,
            };
        }

        return this.prisma.sessionLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            // Перевіряємо та конвертуємо skip/take, якщо вони прийшли як рядки
            skip: filters.skip ? Number(filters.skip) : 0,
            take: filters.take ? Number(filters.take) : 50,
            include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
        });
    }

    async getForbiddenActionsJournal(filters: LogFilterDto) {
        // Примусово обмежуємо пошук тільки забороненими діями
        filters.eventType = SessionEventType.ForbiddenAction;
        return this.getSessionLogs(filters);
    }

    async getIncidentsJournal(filters: LogFilterDto) {
        // Примусово обмежуємо пошук тільки інцидентами
        filters.isIncident = true;
        return this.getSessionLogs(filters);
    }
}