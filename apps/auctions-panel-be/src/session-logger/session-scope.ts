import { ForbiddenException } from '@nestjs/common';
import { Prisma, Roles } from '@prisma/client';

export type DispatcherUser = { id: string; role: Roles; managedGroup?: { id: string } | null };

// Сесії, видимі адміністратору (ТЗ 10): SuperAdmin - усі; GA - ті, до яких підключався він сам
// або учасники групи користувачів, якою він керує.
export function sessionScope(user: DispatcherUser): Prisma.SessionWhereInput {
  if (user.role === Roles.SuperAdmin) return {};
  const groupId = user.role === Roles.Admin ? user.managedGroup?.id : undefined;
  if (!groupId) throw new ForbiddenException('Ви не керуєте жодною групою');
  return { connections: { some: { OR: [{ userId: user.id }, { user: { userGroupId: groupId } }] } } };
}

// Межі дат: дата без часу для кінця діапазону включає весь день.
export function dateRange(startDate?: string, endDate?: string): Prisma.DateTimeFilter | undefined {
  if (!startDate && !endDate) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (startDate) range.gte = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return range;
}

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function userTextWhere(text: string): Prisma.UserWhereInput {
  return {
    OR: [
      { firstName: { contains: text, mode: 'insensitive' } },
      { lastName: { contains: text, mode: 'insensitive' } },
      { email: { contains: text, mode: 'insensitive' } },
    ],
  };
}
