import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuctionGroup, Prisma, Roles, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddPathDto } from './dto/add-path.dto';
import { AddSelectorDto } from './dto/add-selector.dto';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

type AuthUser = { id: string; role: Roles; auctionGroupId?: string | null; managedGroup?: AuctionGroup };

@Injectable()
export class AuctionsService {
  constructor(private prismaService: PrismaService) { }

  // ДОДАНО: єдина точка визначення "своєї" групи для Admin — це managedGroup.id,
  // а не auctionGroupId (те поле стосується лише звичайних User в групі).
  private getUserGroupId(user: AuthUser): string | null {
    if (user.role === Roles.Admin) {
      return user.managedGroup?.id ?? null;
    }
    return user.auctionGroupId ?? null;
  }

  private assertGroupAccess(user: AuthUser, targetGroupId?: string | null) {
    if (user.role === Roles.SuperAdmin) return;
    if (user.role === Roles.Admin) {
      if (!targetGroupId || targetGroupId !== user?.managedGroup?.id) {
        throw new ForbiddenException('Немає доступу до ресурсів іншої групи');
      }
      return;
    }
    throw new ForbiddenException('Недостатньо прав');
  }

  private async assertAuctionGroupAccess(user: AuthUser, auctionId: string) {
    if (user.role === Roles.SuperAdmin) return;
    const auction = await this.prismaService.auction.findUnique({
      where: { id: auctionId },
      select: { auctionGroupId: true },
    });
    if (!auction) throw new NotFoundException('Аукціон не знайдено');
    this.assertGroupAccess(user, auction.auctionGroupId);
  }

  async create(createAuctionDto: CreateAuctionDto, user: AuthUser) {
    const { users, sessions, auctionAuths, auctionGroupId, ...rest } = createAuctionDto;

    // ЗМІНЕНО: Group Admin не може створити аукціон у чужій групі —
    // groupId примусово підміняється на власну групу адміна (managedGroup.id).
    const effectiveGroupId = user.role === Roles.SuperAdmin ? auctionGroupId : this.getUserGroupId(user);

    if (user.role === Roles.Admin && !this.getUserGroupId(user)) {
      throw new ForbiddenException('Group Admin без прив’язки до групи не може створювати аукціони');
    }

    const auction = await this.prismaService.auction.create({
      data: {
        ...rest,

        ...(effectiveGroupId && {
          auctionGroup: {
            connect: { id: effectiveGroupId },
          },
        }),

        ...(users && {
          users: {
            connect: users.map((id) => ({ id })),
          },
        }),

        ...(sessions && {
          sessions: {
            connect: sessions.map((id) => ({ id })),
          },
        }),

        ...(auctionAuths && {
          auctionAuths: {
            connect: auctionAuths.map((id) => ({ id })),
          },
        }),
      },
    });

    return auction;
  }

  async findAll(groupId: string, user?: AuthUser) {
    if (!user?.id) return [];

    // ЗМІНЕНО: SuperAdmin бачить будь-яку групу.
    // Group Admin (Roles.Admin) — тільки СВОЮ групу, навіть якщо передав інший groupId.
    if (user.role === Roles.SuperAdmin) {
      return this.prismaService.auction.findMany({
        where: { auctionGroupId: groupId },
        include: {
          users: true,
          sessions: true,
          auctionAuths: true,
          auctionGroup: true,
        },
      });
    }

    if (user.role === Roles.Admin) {
      if (groupId !== this.getUserGroupId(user)) {
        throw new ForbiddenException('Немає доступу до аукціонів іншої групи');
      }
      return this.prismaService.auction.findMany({
        where: { auctionGroupId: groupId },
        include: {
          users: true,
          sessions: true,
          auctionAuths: true,
          auctionGroup: true,
        },
      });
    }

    // User — лише аукціони, до яких він явно доданий, або (додатково) аукціони
    // його групи, ЯКЩО запитувана група збігається з його власною.
    const orConditions: any[] = [
      {
        users: {
          some: { id: user.id },
        },
      },
    ];

    if (user.auctionGroupId && user.auctionGroupId === groupId) {
      orConditions.push({
        auctionGroupId: user.auctionGroupId,
      });
    }

    return this.prismaService.auction.findMany({
      where: {
        auctionGroupId: groupId,
        OR: orConditions,
      },
      include: {
        users: true,
        sessions: true,
        auctionAuths: true,
        auctionGroup: true,
      },
    });
  }

  async findOne(id: string, user?: AuthUser) {
    if (!user?.id) {
      throw new ForbiddenException('Потрібна авторизація');
    }

    if (user.role === Roles.SuperAdmin) {
      const auction = await this.prismaService.auction.findUnique({
        where: { id },
        include: {
          users: true,
          sessions: true,
          auctionAuths: true,
          auctionGroup: true,
        },
      });

      if (!auction) {
        throw new NotFoundException('Аукціон не знайдено');
      }

      return auction;
    }

    if (user.role === Roles.Admin) {
      const auction = await this.prismaService.auction.findFirst({
        where: { id, auctionGroupId: this.getUserGroupId(user) },
        include: {
          users: true,
          sessions: true,
          auctionAuths: true,
          auctionGroup: true,
        },
      });

      if (!auction) {
        throw new NotFoundException('Аукціон не знайдено або немає доступу');
      }

      return auction;
    }

    const orConditions: any[] = [
      {
        users: {
          some: { id: user.id },
        },
      },
    ];

    if (user.auctionGroupId) {
      orConditions.push({
        auctionGroupId: user.auctionGroupId,
      });
    }

    const auction = await this.prismaService.auction.findFirst({
      where: {
        id,
        OR: orConditions,
      },
      include: {
        users: true,
        sessions: true,
        auctionAuths: true,
        auctionGroup: true,
      },
    });

    if (!auction) {
      throw new NotFoundException('Аукціон не знайдено або немає доступу');
    }

    return auction;
  }

  async update(id: string, updateAuctionDto: UpdateAuctionDto, user: AuthUser) {
    // ДОДАНО: GA може редагувати лише аукціони своєї групи.
    await this.assertAuctionGroupAccess(user, id);

    const { users, sessions, auctionAuths, auctionGroupId, ...rest } = updateAuctionDto;

    // ЗМІНЕНО: перепризначати аукціон в іншу групу може тільки SuperAdmin.
    const canReassignGroup = user.role === Roles.SuperAdmin;

    try {
      return await this.prismaService.auction.update({
        where: { id },
        data: {
          ...rest,

          ...(canReassignGroup &&
            auctionGroupId !== undefined && {
            auctionGroup: auctionGroupId
              ? { connect: { id: auctionGroupId } }
              : { disconnect: true },
          }),

          ...(users && {
            users: {
              set: users.map((id) => ({ id })),
            },
          }),

          ...(sessions && {
            sessions: {
              set: sessions.map((id) => ({ id })),
            },
          }),

          ...(auctionAuths && {
            auctionAuths: {
              set: auctionAuths.map((id) => ({ id })),
            },
          }),
        },
        include: {
          users: true,
          sessions: true,
          auctionAuths: true,
          auctionGroup: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(`Auction with ID ${id} not found.`);
      }
      throw error;
    }
  }

  async remove(id: string, user: AuthUser) {
    // ДОДАНО: видалення аукціону — тільки в межах своєї групи для GA.
    await this.assertAuctionGroupAccess(user, id);

    await this.prismaService.session.deleteMany({
      where: { auctionId: id },
    });

    await this.prismaService.auctionAuth.deleteMany({
      where: { auctionId: id }
    })

    return await this.prismaService.auction.delete({
      where: { id },
    });
  }

  async addUser(auctionId: string, userId: string, adminUser: AuthUser) {
    // ДОДАНО: перевірка групи.
    await this.assertAuctionGroupAccess(adminUser, auctionId);

    const auction = await this.prismaService.auction.findUnique({
      where: { id: auctionId },
      include: { users: true },
    });

    const alreadyAdded = auction?.users.some((u) => u.id === userId);

    if (alreadyAdded) return auction;

    return await this.prismaService.auction.update({
      where: { id: auctionId },
      data: {
        users: {
          connect: { id: userId },
        },
      },
    });
  }

  async removeUser(auctionId: string, userId: string, adminUser: AuthUser) {
    await this.assertAuctionGroupAccess(adminUser, auctionId);

    const auction = await this.prismaService.auction.findUnique({
      where: { id: auctionId },
      include: { users: true },
    });

    if (!auction) {
      throw new NotFoundException('Аукціон не знайдено');
    }

    const isAttached = auction.users.some((u) => u.id === userId);

    if (!isAttached) {
      return auction;
    }

    return await this.prismaService.auction.update({
      where: { id: auctionId },
      data: {
        users: {
          disconnect: { id: userId },
        },
      },
    });
  }

  async search(params: {
    user?: AuthUser;
    query?: string;
    auctionGroupId?: string;
  }) {
    const { user, query, auctionGroupId } = params;

    // ВИДАЛЕНО: console.log(user, query, auctionGroupId, isAdmin) — не логуємо
    // персональні дані користувача в продакшн-логи.

    const andConditions: any[] = [];

    if (query) {
      andConditions.push({
        OR: [
          {
            title: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            url: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
      });
    }

    if (user?.role === Roles.SuperAdmin) {
      // SuperAdmin може фільтрувати по будь-якій групі (або без фільтра — всі).
      if (auctionGroupId) {
        andConditions.push({ auctionGroupId });
      }
    } else if (user?.role === Roles.Admin) {
      // ЗМІНЕНО: GA завжди обмежений своєю групою (managedGroup.id),
      // навіть якщо в query передали іншу.
      andConditions.push({ auctionGroupId: this.getUserGroupId(user) });
    } else {
      const orConditions: any[] = [
        {
          users: {
            some: { id: user?.id },
          },
        },
      ];

      if (user?.auctionGroupId) {
        orConditions.push({
          auctionGroupId: user.auctionGroupId,
        });
      }

      andConditions.push({
        OR: orConditions,
      });
    }

    return this.prismaService.auction.findMany({
      where: andConditions.length > 0 ? { AND: andConditions } : {},
      include: {
        auctionGroup: true,
      },
      orderBy: { title: 'asc' },
    });
  }

  async addSelector(auctionId: string, body: AddSelectorDto, adminUser: AuthUser) {
    // ДОДАНО: GA може додавати заборонені селектори лише для свого аукціону.
    await this.assertAuctionGroupAccess(adminUser, auctionId);

    const selector = await this.prismaService.forbiddenSelector.create({
      data: {
        ...body,
        auction: {
          connect: { id: auctionId },
        },
      }
    })
    return selector;
  }

  async addPathAllowed(auctionId: string, body: AddPathDto, adminUser: AuthUser) {
    await this.assertAuctionGroupAccess(adminUser, auctionId);

    const allowed = await this.prismaService.allowedRoute.create({
      data: {
        ...body,
        auction: {
          connect: { id: auctionId },
        },
      }
    })
    return allowed;
  }

  async addPathForbidden(auctionId: string, body: AddPathDto, adminUser: AuthUser) {
    await this.assertAuctionGroupAccess(adminUser, auctionId);

    const forbidden = await this.prismaService.forbiddenRoute.create({
      data: {
        ...body,
        auction: {
          connect: { id: auctionId },
        },
      }
    })
    return forbidden;
  }

  // ДОДАНО: для видалення allowed/forbidden path та selector спершу знаходимо
  // запис, дістаємо auctionId і перевіряємо групу GA — інакше GA міг видалити
  // правило будь-якого аукціону, знаючи лише id запису.
  async deletePathAllowed(allowedId: string, adminUser: AuthUser) {
    const record = await this.prismaService.allowedRoute.findUnique({ where: { id: allowedId } });
    if (!record) return { status: true };
    await this.assertAuctionGroupAccess(adminUser, record.auctionId);

    await this.prismaService.allowedRoute.deleteMany({
      where: { id: allowedId }
    })
    return { status: true }
  }

  async deletePathForbidden(id: string, adminUser: AuthUser) {
    const record = await this.prismaService.forbiddenRoute.findUnique({ where: { id } });
    if (!record) return { status: true };
    await this.assertAuctionGroupAccess(adminUser, record.auctionId);

    await this.prismaService.forbiddenRoute.deleteMany({
      where: { id }
    })
    return { status: true }
  }

  async deleteSelector(id: string, adminUser: AuthUser) {
    const record = await this.prismaService.forbiddenSelector.findUnique({ where: { id } });
    if (!record) return { status: true };
    await this.assertAuctionGroupAccess(adminUser, record.auctionId);

    await this.prismaService.forbiddenSelector.deleteMany({
      where: { id }
    })
    return { status: true }
  }

  async getForbiddenPath(id: string) {
    const paths = await this.prismaService.forbiddenRoute.findMany({ where: { auctionId: id } });
    return paths;
  }

  async getForbiddenSelector(auctionId: string, user: User) {
    const selectors = await this.prismaService.forbiddenSelector.findMany({
      where: { auctionId },
    });

    // ЗМІНЕНО: неавторизований запит більше не отримує повний список
    // (раніше `!user` потрапляв у ту саму гілку, що й SuperAdmin).
    if (!user) {
      throw new ForbiddenException('Потрібна авторизація');
    }

    if (user.role === Roles.SuperAdmin) return selectors;

    const canBuy = user.sessionRights === 'Buy' || user.sessionRights === 'All';

    if (canBuy) {
      return selectors.filter(selector => selector.isBuyAction === false);
    }
    return selectors;
  }

  async getAllowedPath(id: string) {
    const paths = await this.prismaService.allowedRoute.findMany({ where: { auctionId: id } });
    return paths;
  }
}