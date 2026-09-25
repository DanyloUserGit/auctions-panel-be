import { Injectable } from '@nestjs/common';
import { LogSeverity, Prisma, SessionEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLogDto, LogFilterDto } from './dto/session-log.dto';
import { dateRange, DispatcherUser, sessionScope, userTextWhere, UUID_REGEX } from './session-scope';

const SEVERITY_ORDER: Record<LogSeverity, number> = { Info: 0, Warning: 1, Critical: 2 };

// Дії користувачів та заборонені дії журналюються завжди (ТЗ 9), незалежно від політики логування.
const ALWAYS_LOGGED: SessionEventType[] = [
    SessionEventType.Navigation,
    SessionEventType.ButtonClick,
    SessionEventType.TextInput,
    SessionEventType.ForbiddenAction,
];

@Injectable()
export class SessionLoggerService {
    private policy: { value: LogSeverity; loadedAt: number } | null = null;

    constructor(private readonly prisma: PrismaService) { }

    // «Політика логування» з глобальних налаштувань: мінімальна важливість системних подій (кеш 30 с).
    private async minSeverity(): Promise<LogSeverity> {
        if (this.policy && Date.now() - this.policy.loadedAt < 30_000) return this.policy.value;
        const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'LOGGING_POLICY' } });
        const value = (setting?.value as LogSeverity) in SEVERITY_ORDER ? (setting!.value as LogSeverity) : LogSeverity.Info;
        this.policy = { value, loadedAt: Date.now() };
        return value;
    }

    async logEvent(dto: CreateLogDto) {
        if (!ALWAYS_LOGGED.includes(dto.eventType) && !dto.isIncident) {
            const severity = dto.severity || LogSeverity.Info;
            if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[await this.minSeverity()]) return null;
        }

        const user = dto.userId ? await this.prisma.user.findUnique({ where: { id: dto.userId } }) : null;
        if (user && dto?.message && dto.message.includes(user.id)) {
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

    private where(filters: LogFilterDto, user: DispatcherUser): Prisma.SessionLogWhereInput {
        const and: Prisma.SessionLogWhereInput[] = [{ session: sessionScope(user) }];

        if (filters.sessionId) and.push({ sessionId: filters.sessionId });
        if (filters.eventType) and.push({ eventType: filters.eventType });
        if (filters.isIncident !== undefined) and.push({ isIncident: filters.isIncident });
        if (filters.userId) and.push({ userId: filters.userId });
        if (filters.auctionId) and.push({ session: { auctionId: filters.auctionId } });
        if (filters.userGroupId) and.push({ user: { userGroupId: filters.userGroupId } });

        const created = dateRange(filters.startDate, filters.endDate);
        if (created) and.push({ createdAt: created });

        if (filters.search) {
            const text = filters.search;
            and.push({
                OR: [
                    { message: { contains: text, mode: 'insensitive' } },
                    ...(UUID_REGEX.test(text) ? [{ sessionId: text }] : []),
                    { user: userTextWhere(text) },
                    { session: { auction: { title: { contains: text, mode: 'insensitive' } } } },
                ],
            });
        }
        return { AND: and };
    }

    // Стрічка подій з прив'язкою до сесії, користувача, аукціону й акаунта (ТЗ 9).
    async getSessionLogs(filters: LogFilterDto, user: DispatcherUser) {
        const orderBy: Prisma.SessionLogOrderByWithRelationInput[] =
            filters.sortBy === 'tag'
                ? [{ eventType: filters.sortOrder }, { createdAt: 'desc' }]
                : [{ createdAt: filters.sortOrder }];

        return this.prisma.sessionLog.findMany({
            where: this.where(filters, user),
            orderBy,
            skip: filters.skip ?? 0,
            take: filters.take ?? 50,
            include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true } },
                session: {
                    select: {
                        id: true,
                        auction: { select: { id: true, title: true } },
                        account: { select: { id: true, title: true } },
                    },
                },
            },
        });
    }

    async getForbiddenActionsJournal(filters: LogFilterDto, user: DispatcherUser) {
        return this.getSessionLogs({ ...filters, eventType: SessionEventType.ForbiddenAction }, user);
    }

    async getIncidentsJournal(filters: LogFilterDto, user: DispatcherUser) {
        return this.getSessionLogs({ ...filters, isIncident: true }, user);
    }
}
