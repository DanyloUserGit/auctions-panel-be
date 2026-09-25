import { Injectable } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { managedGroupWhere } from '../users/managed-group';

export type CrmUser = { id: string; role: Roles };

// Чиї записи CRM бачить користувач (ТЗ 13, 19): User - лише свої, GA - свої та учасників
// групи, якою керує, SuperAdmin - усі. null означає «без обмежень».
@Injectable()
export class CrmScopeService {
    constructor(private readonly prisma: PrismaService) { }

    async ownerIds(user: CrmUser): Promise<string[] | null> {
        if (user.role === Roles.SuperAdmin) return null;
        if (user.role !== Roles.Admin) return [user.id];

        const group = await this.prisma.userGroup.findFirst({
            where: managedGroupWhere(user.id),
            select: { users: { select: { id: true } } },
        });
        return [user.id, ...(group?.users.map((u) => u.id) ?? [])];
    }

    async canAccessOwner(user: CrmUser, ownerId: string | null | undefined): Promise<boolean> {
        const ids = await this.ownerIds(user);
        return ids === null || (!!ownerId && ids.includes(ownerId));
    }

    // Клієнти CRM (zamovnyk), чиї процеси й баланси бачить користувач: призначені йому,
    // для GA - також призначені учасникам групи. null - без обмежень (SuperAdmin).
    async clientNames(user: CrmUser): Promise<string[] | null> {
        const owners = await this.ownerIds(user);
        if (owners === null) return null;

        const rows = await this.prisma.crmClientAssignment.findMany({
            where: { userId: { in: owners } },
            select: { clientName: true },
            distinct: ['clientName'],
        });
        return rows.map((r) => r.clientName);
    }
}
