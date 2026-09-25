import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Roles, User } from '@prisma/client';

import { AccessService, type AccessUser } from '../access/access.service';
import { SAFE_AUTH_SELECT, accountSelectFor } from '../auction-auth/auction-auth.select';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { managedGroupIdOf, managedGroupWhere } from '../users/managed-group';
import { CreateUserGroupDto } from './dto/create-user-group.dto';
import { UpdateUserGroupDto } from './dto/update-user-group.dto';


@Injectable()
export class UserGroupsService {
    constructor(
        private prisma: PrismaService,
        private notificationService: NotificationService,
        private access: AccessService,
    ) { }

    // Не-SuperAdmin бачить лише власну групу: Admin - ту, якою керує, User - ту, до якої належить.
    private async ownGroupWhere(user: AccessUser): Promise<Prisma.UserGroupWhereInput> {
        if (user.role === Roles.Admin) return managedGroupWhere(user.id);

        const userFull = await this.prisma.user.findUnique({
            where: { id: user.id },
            select: { userGroupId: true },
        });
        return userFull?.userGroupId ? { id: userFull.userGroupId } : { id: { in: [] } };
    }

    // Дозволені групи аукціонів/аукціони/акаунти для не-SuperAdmin - лише реально доступні
    // за ланцюгом AccessService (неактивна група = порожні списки), разом із кількостями.
    private async effectiveAccessInclude(user: AccessUser) {
        const userGroupId = await this.access.getActiveUserGroupId(user);
        const none = { id: { in: [] as string[] } };
        const auctionGroupsWhere = userGroupId ? AccessService.allowedAuctionGroupsWhere(userGroupId) : none;
        const auctionsWhere = userGroupId ? AccessService.allowedAuctionsWhere(userGroupId) : none;

        // Учасникам (роль User) групи з вимкненим showAccounts список акаунтів групи не показується.
        const group = userGroupId
            ? await this.prisma.userGroup.findUnique({ where: { id: userGroupId }, select: { showAccounts: true } })
            : null;
        const hideAccounts = user.role === Roles.User && !group?.showAccounts;
        const accountsWhere = userGroupId && !hideAccounts ? AccessService.allowedAccountsWhere(userGroupId) : none;

        return {
            allowedAuctionGroups: { where: auctionGroupsWhere },
            allowedAuctions: { where: auctionsWhere },
            allowedAccounts: { where: accountsWhere, select: accountSelectFor(user.role) },
            _count: {
                select: {
                    users: true,
                    allowedAuctions: { where: auctionsWhere },
                    allowedAuctionGroups: { where: auctionGroupsWhere },
                },
            },
        };
    }

    private readonly adminSelect = {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        city: true,
        telegramChatId: true,
        viberId: true,
        role: true,
        accessStatus: true,
        isActive: true,
        isBlocked: true,
        sessionLimit: true,
        lastLogin: true,
        lastActivity: true,
        userGroupId: true,
    } as const;

    private withCounts(data: any | any[]) {
        if (!data) return data;

        const formatGroup = (group: any) => {
            const adminCount = group.AdminId ? 1 : 0;
            const usersCount = (group._count?.users || 0) + adminCount;
            const auctionsCount = group._count?.allowedAuctions || 0;

            return {
                ...group,
                usersCount,
                auctionsCount,
            };
        };

        if (Array.isArray(data)) {
            return data.map(formatGroup);
        }
        return formatGroup(data);
    }

    // SuperAdmin керує будь-якою групою, Admin (GroupAdmin) - лише групою, адміністратором якої він є.
    async assertCanManageGroup(groupId: string, user?: { id: string; role: Roles }) {
        if (user?.role === Roles.SuperAdmin) return;

        if (user?.role === Roles.Admin) {
            const group = await this.prisma.userGroup.findUnique({
                where: { id: groupId },
                select: { AdminId: true },
            });

            if (!group) {
                throw new NotFoundException('Групу користувачів не знайдено');
            }

            if (group.AdminId === user.id || (await managedGroupIdOf(this.prisma, user.id)) === groupId) return;
        }

        throw new ForbiddenException('Немає прав керувати цією групою користувачів');
    }

    async create(createUserGroupDto: CreateUserGroupDto, user: User) {
        const { allowedAuctions, Admin, users, ...rest } = createUserGroupDto;

        const isSuperAdmin = user?.role === Roles.SuperAdmin;
        if (!isSuperAdmin) {
            delete createUserGroupDto.canGaManageAccounts;
            delete createUserGroupDto.showAccounts;
        }

        const group = await this.prisma.userGroup.create({
            data: {
                ...rest,
                ...(Admin && {
                    Admin: {
                        connect: { id: Admin },
                    },
                }),
                ...(users && {
                    users: {
                        connect: users.map((id) => ({ id })),
                    },
                }),
                ...(allowedAuctions && {
                    allowedAuctions: {
                        connect: allowedAuctions.map((id) => ({ id })),
                    },
                }),
                isActive: true,
                lastActivity: new Date(),
            },
            include: {
                allowedAuctions: true,
            },
        });

        if (users && users.length > 0) {
            await this.notificationService.notifyGroupAdminAboutNewMember(group.id, users);
        }

        return group;
    }

    async findAll(user?: { id: string; role: Roles }) {
        if (!user?.id) return [];

        const isSuperAdmin = user?.role === Roles.SuperAdmin;

        if (isSuperAdmin) {
            const groups = await this.prisma.userGroup.findMany({
                include: {
                    Admin: { select: this.adminSelect },
                    allowedAuctions: true,
                    _count: { select: { users: true, allowedAuctions: true } },
                },
            });
            return this.withCounts(groups);
        }

        const groups = await this.prisma.userGroup.findMany({
            where: await this.ownGroupWhere(user),
            include: {
                Admin: { select: this.adminSelect },
                ...(await this.effectiveAccessInclude(user)),
            },
        });

        return this.withCounts(groups);
    }

    async findOne(id: string, user?: { id: string; role: Roles }) {
        if (!user?.id) {
            throw new ForbiddenException('Потрібна авторизація');
        }

        const isSuperAdmin = user?.role === Roles.SuperAdmin;

        if (isSuperAdmin) {
            const groups = await this.prisma.userGroup.findFirst({
                where: { id },
                include: {
                    Admin: { select: this.adminSelect },
                    allowedAuctions: true,
                    allowedAuctionGroups: true,
                    allowedAccounts: { select: SAFE_AUTH_SELECT },
                    _count: {
                        select: {
                            users: true,
                            allowedAuctions: true,
                            allowedAuctionGroups: true,
                        },
                    },
                },
            });
            return this.withCounts(groups);
        }

        const group = await this.prisma.userGroup.findFirst({
            where: { AND: [{ id }, await this.ownGroupWhere(user)] },
            include: {
                Admin: { select: this.adminSelect },
                ...(await this.effectiveAccessInclude(user)),
            },
        });

        if (!group) {
            throw new NotFoundException('Групу користувачів не знайдено або немає доступу');
        }

        return this.withCounts(group);
    }

    async getUsersByGroupId(groupId: string) {
        const group = await this.prisma.userGroup.findUnique({
            where: { id: groupId },
            include: { users: true }, // Завантажуємо пов'язаних користувачів
        });

        if (!group) {
            throw new NotFoundException('Групу користувачів не знайдено');
        }

        return group.users;
    }

    async removeUserFromGroup(groupId: string, userId: string) {
        // Перевіряємо, чи існує група (опціонально, але корисно для обробки помилок)
        const group = await this.prisma.userGroup.findUnique({
            where: { id: groupId }
        });

        if (!group) {
            throw new NotFoundException('Групу користувачів не знайдено');
        }

        return this.prisma.userGroup.update({
            where: { id: groupId },
            data: {
                users: {
                    disconnect: { id: userId },
                },
                lastActivity: new Date(), // Оновлюємо час останньої активності, як у наявних методах
            },
        });
    }

    async update(id: string, updateUserGroupDto: UpdateUserGroupDto, user: User) {
        const isSuperAdmin = user?.role === Roles.SuperAdmin;
        if (!isSuperAdmin) {
            delete updateUserGroupDto.canGaManageAccounts;
            delete updateUserGroupDto.showAccounts;
            delete updateUserGroupDto.sessionLimit;
            delete updateUserGroupDto.canGaManageRules;
            // Перепризначати адміністратора групи, змінювати склад групи та доступи може лише SuperAdmin.
            // Інакше GA міг би «перетягнути» у свою групу користувача з іншої групи.
            delete updateUserGroupDto.Admin;
            delete updateUserGroupDto.allowedAuctions;
            delete updateUserGroupDto.users;
        }

        const { allowedAuctions, Admin, users, ...rest } = updateUserGroupDto;

        const group = await this.prisma.userGroup.update({
            where: { id },
            data: {
                ...rest,
                ...(Admin && {
                    Admin: {
                        connect: { id: Admin },
                    },
                }),
                ...(users && {
                    users: {
                        connect: users.map((id) => ({ id })),
                    },
                }),
                ...(allowedAuctions && {
                    allowedAuctions: {
                        set: allowedAuctions.map((id) => ({ id })),
                    },
                }),
                lastActivity: new Date(),
            },
            include: {
                allowedAuctions: true,
            },
        });

        if (users && users.length > 0) {
            await this.notificationService.notifyGroupAdminAboutNewMember(group.id, users);
        }

        return group;
    }

    async blockGroup(id: string) {
        return this.prisma.userGroup.update({ where: { id }, data: { isActive: false } });
    }

    async unBlockGroup(id: string) {
        return this.prisma.userGroup.update({ where: { id }, data: { isActive: true } });
    }

    async remove(id: string) {
        return this.prisma.userGroup.delete({
            where: { id },
        });
    }

    async search(params: { user: AccessUser; query?: string }) {
        const { user, query } = params;
        const nameWhere: Prisma.UserGroupWhereInput = query
            ? { name: { contains: query, mode: 'insensitive' } }
            : {};

        if (user.role === Roles.SuperAdmin) {
            const groups = await this.prisma.userGroup.findMany({
                where: nameWhere,
                include: {
                    allowedAuctions: true,
                    Admin: { select: this.adminSelect },
                    _count: { select: { users: true, allowedAuctions: true } },
                },
                orderBy: { name: 'asc' },
            });
            return this.withCounts(groups);
        }

        const groups = await this.prisma.userGroup.findMany({
            where: { AND: [nameWhere, await this.ownGroupWhere(user)] },
            include: {
                Admin: { select: this.adminSelect },
                ...(await this.effectiveAccessInclude(user)),
            },
            orderBy: { name: 'asc' },
        });

        return this.withCounts(groups);
    }

    async addAllowedAuction(groupId: string, auctionId: string) {
        const group = await this.prisma.userGroup.findUnique({
            where: { id: groupId },
            include: { allowedAuctions: true },
        });

        if (!group) {
            throw new NotFoundException('Групу користувачів не знайдено');
        }

        const alreadyAdded = group.allowedAuctions.some((a) => a.id === auctionId);
        if (alreadyAdded) return group;

        return this.prisma.userGroup.update({
            where: { id: groupId },
            data: {
                allowedAuctions: {
                    connect: { id: auctionId },
                },
                lastActivity: new Date(),
            },
        });
    }

    async removeAllowedAuction(groupId: string, auctionId: string) {
        const group = await this.prisma.userGroup.findUnique({
            where: { id: groupId },
            include: { allowedAuctions: true },
        });

        if (!group) {
            throw new NotFoundException('Групу користувачів не знайдено');
        }

        const isAttached = group.allowedAuctions.some((a) => a.id === auctionId);
        if (!isAttached) return group;

        return this.prisma.userGroup.update({
            where: { id: groupId },
            data: {
                allowedAuctions: {
                    disconnect: { id: auctionId },
                },
                lastActivity: new Date(),
            },
        });
    }

    async addAllowedAuctionGroup(groupId: string, auctionGroupId: string) {
        const group = await this.prisma.userGroup.findUnique({
            where: { id: groupId },
            include: { allowedAuctionGroups: true },
        });

        if (!group) {
            throw new NotFoundException('Групу користувачів не знайдено');
        }

        const alreadyAdded = group.allowedAuctionGroups.some((ag) => ag.id === auctionGroupId);
        if (alreadyAdded) return group;

        return this.prisma.userGroup.update({
            where: { id: groupId },
            data: {
                allowedAuctionGroups: {
                    connect: { id: auctionGroupId },
                },
                lastActivity: new Date(),
            },
        });
    }

    async removeAllowedAuctionGroup(groupId: string, auctionGroupId: string) {
        const group = await this.prisma.userGroup.findUnique({
            where: { id: groupId },
            include: { allowedAuctionGroups: true },
        });

        if (!group) {
            throw new NotFoundException('Групу користувачів не знайдено');
        }

        const isAttached = group.allowedAuctionGroups.some((ag) => ag.id === auctionGroupId);
        if (!isAttached) return group;

        return this.prisma.userGroup.update({
            where: { id: groupId },
            data: {
                allowedAuctionGroups: {
                    disconnect: { id: auctionGroupId },
                },
                lastActivity: new Date(),
            },
        });
    }

    async addAllowedAccount(groupId: string, accountId: string) {
        const group = await this.prisma.userGroup.findUnique({
            where: { id: groupId },
            include: { allowedAccounts: { select: { id: true } } },
        });

        if (!group) {
            throw new NotFoundException('Групу користувачів не знайдено');
        }

        const alreadyAdded = group.allowedAccounts.some((a) => a.id === accountId);
        if (alreadyAdded) return group;

        return this.prisma.userGroup.update({
            where: { id: groupId },
            data: {
                allowedAccounts: {
                    connect: { id: accountId },
                },
                lastActivity: new Date(),
            },
        });
    }

    async removeAllowedAccount(groupId: string, accountId: string) {
        const group = await this.prisma.userGroup.findUnique({
            where: { id: groupId },
            include: { allowedAccounts: { select: { id: true } } },
        });

        if (!group) {
            throw new NotFoundException('Групу користувачів не знайдено');
        }

        const isAttached = group.allowedAccounts.some((a) => a.id === accountId);
        if (!isAttached) return group;

        return this.prisma.userGroup.update({
            where: { id: groupId },
            data: {
                allowedAccounts: {
                    disconnect: { id: accountId },
                },
                lastActivity: new Date(),
            },
        });
    }

}