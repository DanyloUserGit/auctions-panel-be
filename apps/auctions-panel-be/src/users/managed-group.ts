import { Prisma, Roles } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Група, якою керує адміністратор (GA): власна (UserGroup.AdminId) або, для співадміністратора,
// призначеного іншим GA (ТЗ 3: «GA може призначати інших GA»), - група, до якої він належить.
export const managedGroupWhere = (userId: string): Prisma.UserGroupWhereInput => ({
  OR: [{ AdminId: userId }, { users: { some: { id: userId, role: Roles.Admin } } }],
});

export async function managedGroupIdOf(prisma: PrismaService, userId: string): Promise<string | null> {
  const group = await prisma.userGroup.findFirst({ where: managedGroupWhere(userId), select: { id: true } });
  return group?.id ?? null;
}
