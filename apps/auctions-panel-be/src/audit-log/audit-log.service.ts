import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuditCategory, Prisma, Roles } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditFilterDto } from './audit-filter.dto';

export type AuditActor = { id: string; role?: Roles } | null | undefined;

export type AuditEntry = {
  action: string;
  message: string;
  actor?: AuditActor;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
  ip?: string;
};

// Поля, які ніколи не потрапляють у журнал (ТЗ 9: «без секретів»).
const SECRET_KEYS = /pass(word)?|token|secret|cookie/i;

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SECRET_KEYS.test(key))
        .map(([key, v]) => [key, stripSecrets(v)]),
    );
  }
  return value;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) { }

  // Журнал не повинен ламати основну дію: помилка запису лише логуються.
  async record(category: AuditCategory, entry: AuditEntry) {
    try {
      await this.prisma.auditLog.create({
        data: {
          category,
          action: entry.action,
          message: entry.message,
          actorId: entry.actor?.id ?? null,
          targetUserId: entry.targetUserId ?? null,
          details: entry.details ? (stripSecrets(entry.details) as Prisma.InputJsonValue) : Prisma.JsonNull,
          ip: entry.ip ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Не вдалося записати подію аудиту ${entry.action}`, error as Error);
    }
  }

  admin(entry: AuditEntry) {
    return this.record(AuditCategory.Admin, entry);
  }

  auth(entry: AuditEntry) {
    return this.record(AuditCategory.Auth, entry);
  }

  // SuperAdmin - усі записи; GA - записи про себе та учасників своєї групи.
  async list(filters: AuditFilterDto, user: { id: string; role: Roles; managedGroup?: { id: string } | null }) {
    const and: Prisma.AuditLogWhereInput[] = [];

    if (user.role !== Roles.SuperAdmin) {
      const groupId = user.role === Roles.Admin ? user.managedGroup?.id : undefined;
      if (!groupId) throw new ForbiddenException('Ви не керуєте жодною групою');
      const member: Prisma.UserWhereInput = { OR: [{ id: user.id }, { userGroupId: groupId }] };
      and.push({ OR: [{ actor: member }, { targetUser: member }] });
    }
    if (filters.category) and.push({ category: filters.category });
    if (filters.userId) and.push({ OR: [{ actorId: filters.userId }, { targetUserId: filters.userId }] });
    if (filters.action) and.push({ action: filters.action });
    if (filters.search) {
      const text = { contains: filters.search, mode: 'insensitive' as const };
      and.push({
        OR: [
          { message: text },
          { actor: { OR: [{ email: text }, { firstName: text }, { lastName: text }] } },
          { targetUser: { OR: [{ email: text }, { firstName: text }, { lastName: text }] } },
        ],
      });
    }
    if (filters.startDate || filters.endDate) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.startDate) createdAt.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        if (/^\d{4}-\d{2}-\d{2}$/.test(filters.endDate)) end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      and.push({ createdAt });
    }

    return this.prisma.auditLog.findMany({
      where: { AND: and },
      orderBy: { createdAt: 'desc' },
      skip: filters.skip ?? 0,
      take: filters.take ?? 100,
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, email: true } },
        targetUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }
}
