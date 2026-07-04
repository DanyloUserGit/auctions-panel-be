import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Roles, User } from '@prisma/client';

import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuctionGroupDto } from './dto/create-auction-group.dto';
import { UpdateAuctionGroupDto } from './dto/update-auction-group.dto';

@Injectable()
export class AuctionGroupsService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) { }

  private withCounts(data: any | any[]) {
    if (!data) return data;

    const formatGroup = (group: any) => {
      const adminCount = group.AdminId ? 1 : 0;
      const usersCount = (group._count?.users || 0) + adminCount;
      const auctionsCount = group._count?.auctions || 0;

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

  async create(createAuctionGroupDto: CreateAuctionGroupDto, user: User) {
    const { auctions, Admin, users, ...rest } = createAuctionGroupDto;

    const isSuperAdmin = user?.role === Roles.SuperAdmin;

    if (!isSuperAdmin) {
      delete createAuctionGroupDto.sessionLimit;
      delete createAuctionGroupDto.canGaManageAccounts;
    }

    const group = await this.prisma.auctionGroup.create({
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
        ...(auctions && {
          auctions: {
            connect: auctions.map((id) => ({ id })),
          },
        }),
        isActive: true,
        lastActivity: new Date(),
      },
      include: {
        auctions: true,
        accounts: true,
      },
    });

    if (users && users.length > 0) {
      await Promise.all(
        users.map((userId) =>
          this.notificationService.notify(userId, 'ADDED_TO_GROUP', {
            subject: 'Додавання до групи',
            body: `Вас додано до групи аукціонів "${group.title}"`,
          }),
        ),
      );
    }

    return group;
  }

  async findAll(user?: { id: string; role: Roles }) {
    if (!user?.id) return [];

    const isSuperAdmin = user?.role === Roles.SuperAdmin;
    const isGroupAdmin = user?.role === Roles.Admin;

    if (isSuperAdmin) {
      const groups = await this.prisma.auctionGroup.findMany({
        include: {
          auctions: true,
          accounts: true,
          _count: { select: { users: true, auctions: true } },
        },
      });
      return this.withCounts(groups);
    }

    if (isGroupAdmin) {
      const groups = await this.prisma.auctionGroup.findMany({
        where: { Admin: { id: user.id } },
        include: {
          auctions: true,
          accounts: true,
          _count: { select: { users: true, auctions: true } },
        },
      });
      return this.withCounts(groups);
    }

    const userFull = await this.prisma.user.findFirst({
      where: { id: user.id },
      select: { auctionGroupId: true }
    });

    const groups = await this.prisma.auctionGroup.findMany({
      where: {
        OR: [
          {
            auctions: {
              some: {
                users: {
                  some: { id: user.id },
                },
              },
            },
          },
          {
            id: userFull?.auctionGroupId || undefined,
          }
        ],
      },
      include: {
        auctions: {
          where: {
            users: {
              some: { id: user.id },
            },
          },
        },
        accounts: true,
        _count: { select: { users: true, auctions: true } },
      },
    });

    return this.withCounts(groups);
    return this.withCounts(groups);
  }

  async findOne(id: string, user?: { id: string; role: Roles }) {
    if (!user?.id) {
      throw new ForbiddenException('Потрібна авторизація');
    }

    const isSuperAdmin = user?.role === Roles.SuperAdmin;
    const isGroupAdmin = user?.role === Roles.Admin;

    if (isSuperAdmin) {
      const groups = await this.prisma.auctionGroup.findMany({
        where: { id },
        include: {
          auctions: true,
          accounts: true,
          _count: {
            select: {
              users: true, auctions: true,
              accounts: true,
            }
          },
        },
      });
      return this.withCounts(groups);
    }

    if (isGroupAdmin) {
      const groups = await this.prisma.auctionGroup.findMany({
        where: { id, Admin: { id: user.id } },
        include: {
          auctions: true,
          _count: {
            select: {
              users: true, auctions: true,
              accounts: true,
            }
          },
        },
      });
      return this.withCounts(groups);
    }

    const group = await this.prisma.auctionGroup.findFirst({
      where: {
        id,
        auctions: {
          some: {
            users: {
              some: {
                id: user.id,
              },
            },
          },
        },
      },
      include: {
        auctions: {
          where: {
            users: {
              some: {
                id: user.id,
              },
            },
          },
        },
        _count: { select: { users: true, auctions: true, accounts: true, } },
      },
    });

    if (!group) {
      throw new NotFoundException('Група аукціонів не знайдена або немає доступу');
    }

    return this.withCounts(group);
  }

  async update(id: string, updateAuctionGroupDto: UpdateAuctionGroupDto, user: User) {
    const isSuperAdmin = user?.role === Roles.SuperAdmin;

    if (!isSuperAdmin) {
      delete updateAuctionGroupDto.sessionLimit;
      delete updateAuctionGroupDto.canGaManageAccounts;
    }

    const { auctions, Admin, users, ...rest } = updateAuctionGroupDto;

    const group = await this.prisma.auctionGroup.update({
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
        ...(auctions && {
          auctions: {
            set: auctions.map((id) => ({ id })),
          },
        }),
        lastActivity: new Date(),
      },
      include: {
        auctions: true,
      },
    });

    if (users && users.length > 0) {
      await Promise.all(
        users.map((userId) =>
          this.notificationService.notify(userId, 'ADDED_TO_GROUP', {
            subject: 'Додавання до групи',
            body: `Вас додано до групи аукціонів "${group.title}"`,
          }),
        ),
      );
    }

    return group;
  }

  async blockGroup(id: string) {
    try {
      return await this.prisma.auctionGroup.update({ where: { id }, data: { isActive: false } })
    } catch (error) {
      throw error;
    }
  }

  async unBlockGroup(id: string) {
    try {
      return await this.prisma.auctionGroup.update({ where: { id }, data: { isActive: true } })
    } catch (error) {
      throw error;
    }
  }

  async remove(id: string) {
    return await this.prisma.auctionGroup.delete({
      where: { id },
    });
  }

  async search(params: { user?: { id: string; role: Roles }; query?: string }) {
    const { user, query } = params;
    const isAdmin = user?.role === Roles.Admin || user?.role === Roles.SuperAdmin;

    const groups = await this.prisma.auctionGroup.findMany({
      where: {
        AND: [
          query
            ? {
              title: {
                contains: query,
                mode: 'insensitive',
              },
            }
            : {},

          !isAdmin
            ? {
              auctions: {
                some: {
                  users: {
                    some: { id: user?.id },
                  },
                },
              },
            }
            : {},
        ],
      },
      include: {
        auctions: isAdmin
          ? true
          : {
            where: {
              users: {
                some: { id: user?.id },
              },
            },
          },
        accounts: true,
        _count: { select: { users: true, auctions: true } },
      },
      orderBy: { title: 'asc' },
    });

    return this.withCounts(groups);
  }

  async addAuction(groupId: string, auctionId: string) {
    const group = await this.prisma.auctionGroup.findUnique({
      where: { id: groupId },
      include: { auctions: true },
    });

    const alreadyAdded = group?.auctions.some((u) => u.id === auctionId);

    if (alreadyAdded) return group;

    return await this.prisma.auctionGroup.update({
      where: { id: groupId },
      data: {
        auctions: {
          connect: { id: auctionId },
        },
        lastActivity: new Date(),
      },
    });
  }

  async removeAuction(groupId: string, userId: string) {
    const group = await this.prisma.auctionGroup.findUnique({
      where: { id: groupId },
      include: { auctions: true },
    });

    if (!group) {
      throw new NotFoundException('Аукціон не знайдено');
    }

    const isAttached = group.auctions.some((u) => u.id === userId);

    if (!isAttached) {
      return group;
    }

    return await this.prisma.auctionGroup.update({
      where: { id: groupId },
      data: {
        auctions: {
          disconnect: { id: userId },
        },
        lastActivity: new Date(),
      },
    });
  }

  async grantAccountAccess(groupId: string, userId: string) {
    return await this.prisma.auctionGroup.update({
      where: { id: groupId },
      data: { accounts: { connect: { id: userId } }, lastActivity: new Date() },
    });
  }

  async revokeAccountAccess(groupId: string, userId: string) {
    return await this.prisma.auctionGroup.update({
      where: { id: groupId },
      data: { accounts: { disconnect: { id: userId } }, lastActivity: new Date() },
    });
  }
}