import { Injectable } from '@nestjs/common';
import { SessionEventType, Prisma } from '@prisma/client';
import { CreateLogDto, LogFilterDto } from './dto/session-log.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionLoggerService {
    constructor(private readonly prisma: PrismaService) { }


    async logEvent(dto: CreateLogDto) {
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
            skip: filters.skip || 0,
            take: filters.take || 50,
            include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true } }, 
            },
        });
    }

    async getForbiddenActionsJournal(auctionGroupId?: string, skip = 0, take = 50) {
        return this.getSessionLogs({
            eventType: SessionEventType.ForbiddenAction,
            auctionGroupId, 
            skip,
            take,
        });
    }

    async getIncidentsJournal(auctionGroupId?: string, skip = 0, take = 50) {
        return this.getSessionLogs({
            isIncident: true,
            auctionGroupId, 
            skip,
            take,
        });
    }
}