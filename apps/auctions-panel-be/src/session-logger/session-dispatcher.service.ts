import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionFilterDto } from './dto/session-filter.dto';
import { dateRange, DispatcherUser, sessionScope, userTextWhere, UUID_REGEX } from './session-scope';

const sessionInclude = {
    auction: { select: { id: true, title: true } },
    account: { select: { id: true, title: true } },
    auctionGroup: { select: { id: true, title: true } },
    endedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
    connections: {
        orderBy: { connectedAt: 'asc' },
        select: {
            disconnectedAt: true,
            connectedAt: true,
            user: {
                select: { id: true, email: true, firstName: true, lastName: true, userGroup: { select: { id: true, name: true } } },
            },
        },
    },
    logs: { orderBy: { createdAt: 'desc' }, take: 1, select: { message: true, eventType: true, createdAt: true } },
} satisfies Prisma.SessionInclude;

type SessionWithDetails = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

@Injectable()
export class SessionDispatcherService {
    constructor(private readonly prisma: PrismaService) { }

    // Завершені сесії разом із журналами видаляються лише після терміну з глобальних налаштувань (ТЗ 9, 10).
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async cleanupOldSessions() {
        const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'SESSION_RETENTION_DAYS' } });
        const retentionDays = setting ? parseInt(setting.value, 10) : 365;
        if (!retentionDays || retentionDays <= 0) return;

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        await this.prisma.session.deleteMany({
            where: { isActive: false, endedAt: { lt: cutoffDate } },
        });
    }

    private where(filters: SessionFilterDto, user: DispatcherUser): Prisma.SessionWhereInput {
        const and: Prisma.SessionWhereInput[] = [sessionScope(user)];

        if (filters.isActive !== undefined) and.push({ isActive: filters.isActive });
        if (filters.status === 'active') and.push({ isActive: true });
        if (filters.status === 'ended') and.push({ isActive: false, OR: [{ endReason: null }, { endReason: { not: 'Error' } }] });
        if (filters.status === 'error') and.push({ isActive: false, endReason: 'Error' });
        if (filters.userId) and.push({ connections: { some: { userId: filters.userId } } });
        if (filters.auctionId) and.push({ auctionId: filters.auctionId });
        if (filters.auctionGroupId) and.push({ auctionGroupId: filters.auctionGroupId });
        if (filters.userGroupId) and.push({ connections: { some: { user: { userGroupId: filters.userGroupId } } } });

        const created = dateRange(filters.startDate, filters.endDate);
        if (created) and.push({ createdAt: created });

        if (filters.search) {
            const text = filters.search;
            and.push({
                OR: [
                    ...(UUID_REGEX.test(text) ? [{ id: text }] : []),
                    { auction: { title: { contains: text, mode: 'insensitive' } } },
                    { account: { title: { contains: text, mode: 'insensitive' } } },
                    { connections: { some: { user: userTextWhere(text) } } },
                ],
            });
        }
        return { AND: and };
    }

    // Картка сесії для «Всіх дій»: учасники й фактична кількість підключень, акаунт, остання подія.
    private toView(session: SessionWithDetails) {
        const { connections, logs, ...rest } = session;
        const users = new Map<string, SessionWithDetails['connections'][number]['user'] & { isConnected: boolean }>();
        for (const c of connections) {
            const connected = c.disconnectedAt === null;
            const existing = users.get(c.user.id);
            users.set(c.user.id, { ...c.user, isConnected: (existing?.isConnected ?? false) || connected });
        }
        return {
            ...rest,
            status: session.isActive ? 'active' : session.endReason === 'Error' ? 'error' : 'ended',
            users: [...users.values()],
            activeConnections: session.isActive ? connections.filter((c) => c.disconnectedAt === null).length : 0,
            lastEvent: logs[0] ?? null,
        };
    }

    async getSessions(filters: SessionFilterDto, user: DispatcherUser) {
        const where = this.where(filters, user);
        const [sessions, total] = await Promise.all([
            this.prisma.session.findMany({
                where,
                skip: filters.skip ?? 0,
                take: filters.take ?? 50,
                orderBy: { createdAt: 'desc' },
                include: sessionInclude,
            }),
            this.prisma.session.count({ where }),
        ]);
        return { data: sessions.map((s) => this.toView(s)), total };
    }
}
