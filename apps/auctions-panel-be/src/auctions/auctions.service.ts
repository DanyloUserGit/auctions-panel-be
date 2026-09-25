import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Roles, User } from '@prisma/client';
import { AccessService, type AccessUser } from '../access/access.service';
import { SAFE_AUTH_SELECT, accountSelectFor } from '../auction-auth/auction-auth.select';
import { PrismaService } from '../prisma/prisma.service';
import { canPurchase } from '../users/access-status';
import { encryptData } from '../utils/encrypt';
import { AddPathDto } from './dto/add-path.dto';
import { AddSelectorDto } from './dto/add-selector.dto';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

// Зашифрований URL проксі + хост для відображення. undefined - не змінювати, '' - прибрати.
function proxyData(proxyUrl: string | undefined) {
  if (proxyUrl === undefined) return {};
  if (!proxyUrl) return { proxyUrl: null, proxyHost: null };
  const parsed = new URL(proxyUrl);
  return { proxyUrl: encryptData(proxyUrl), proxyHost: `${parsed.protocol}//${parsed.host}` };
}

@Injectable()
export class AuctionsService {
  constructor(
    private prismaService: PrismaService,
    private access: AccessService
  ) { }

  // Створення/редагування/видалення аукціонів та їхніх правил - лише SuperAdmin (RolesGuard у контролері).
  // Новий аукціон не додається до жодної групи користувачів автоматично.
  async create(createAuctionDto: CreateAuctionDto) {
    const { sessions, auctionAuths, auctionGroupId, proxyUrl, ...rest } = createAuctionDto;

    const auction = await this.prismaService.auction.create({
      data: {
        ...rest,
        ...proxyData(proxyUrl),

        ...(auctionGroupId && {
          auctionGroup: {
            connect: { id: auctionGroupId },
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

  // Лише явно дозволені аукціони: дозвіл групи аукціонів сам по собі їх не відкриває.
  // Вкладені акаунти теж обмежуються дозволеними для користувача.
  async findAll(groupId: string, user?: AccessUser) {
    if (!user?.id) return [];

    return this.prismaService.auction.findMany({
      where: { AND: [{ auctionGroupId: groupId }, await this.access.auctionWhere(user)] },
      include: {
        sessions: true,
        auctionAuths: { where: await this.access.visibleAccountWhere(user), select: accountSelectFor(user.role) },
        auctionGroup: true,
      },
    });
  }

  async findOne(id: string, user?: AccessUser) {
    if (!user?.id) {
      throw new ForbiddenException('Потрібна авторизація');
    }

    const auction = await this.prismaService.auction.findFirst({
      where: { AND: [{ id }, await this.access.auctionWhere(user)] },
      include: {
        sessions: true,
        auctionAuths: { where: await this.access.visibleAccountWhere(user), select: accountSelectFor(user.role) },
        auctionGroup: true,
      },
    });

    if (!auction) {
      throw new NotFoundException('Аукціон не знайдено або немає доступу');
    }

    return auction;
  }

  async update(id: string, updateAuctionDto: UpdateAuctionDto) {
    const { sessions, auctionAuths, auctionGroupId, proxyUrl, ...rest } = updateAuctionDto;

    try {
      return await this.prismaService.auction.update({
        where: { id },
        data: {
          ...rest,
          ...proxyData(proxyUrl),

          ...(auctionGroupId !== undefined && {
            auctionGroup: auctionGroupId
              ? { connect: { id: auctionGroupId } }
              : { disconnect: true },
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
          sessions: true,
          auctionAuths: { select: SAFE_AUTH_SELECT },
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

  // Видалення аукціону разом з акаунтами, правилами та історією його сесій (каскадно в БД).
  // Поки на аукціоні працюють користувачі, видалити його не можна.
  async remove(id: string) {
    const active = await this.prismaService.session.count({ where: { auctionId: id, isActive: true } });
    if (active > 0) {
      throw new ConflictException('На аукціоні є активні сесії - спершу завершіть їх у «Всіх діях»');
    }
    return await this.prismaService.auction.delete({
      where: { id },
    });
  }

  async search(params: {
    user: AccessUser;
    query?: string;
    auctionGroupId?: string;
  }) {
    const { user, query, auctionGroupId } = params;

    const andConditions: Prisma.AuctionWhereInput[] = [await this.access.auctionWhere(user)];

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

    if (auctionGroupId) {
      andConditions.push({ auctionGroupId });
    }

    return this.prismaService.auction.findMany({
      where: { AND: andConditions },
      include: {
        auctionGroup: true,
      },
      orderBy: { title: 'asc' },
    });
  }

  async addSelector(auctionId: string, body: AddSelectorDto) {
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

  async addPathAllowed(auctionId: string, body: AddPathDto) {
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

  async addPathForbidden(auctionId: string, body: AddPathDto) {
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

  async deletePathAllowed(allowedId: string) {
    const record = await this.prismaService.allowedRoute.findUnique({ where: { id: allowedId } });
    if (!record) return { status: true };

    await this.prismaService.allowedRoute.deleteMany({
      where: { id: allowedId }
    })
    return { status: true }
  }

  async deletePathForbidden(id: string) {
    const record = await this.prismaService.forbiddenRoute.findUnique({ where: { id } });
    if (!record) return { status: true };

    await this.prismaService.forbiddenRoute.deleteMany({
      where: { id }
    })
    return { status: true }
  }

  async deleteSelector(id: string) {
    const record = await this.prismaService.forbiddenSelector.findUnique({ where: { id } });
    if (!record) return { status: true };

    await this.prismaService.forbiddenSelector.deleteMany({
      where: { id }
    })
    return { status: true }
  }

  // Правила аукціону - лише тим, хто має доступ до аукціону.
  async getForbiddenPath(id: string, user: AccessUser) {
    await this.access.assertCanAccessAuction(user, id);
    const paths = await this.prismaService.forbiddenRoute.findMany({ where: { auctionId: id } });
    return paths;
  }

  async getForbiddenSelector(auctionId: string, user: User) {
    if (!user) {
      throw new ForbiddenException('Потрібна авторизація');
    }
    await this.access.assertCanAccessAuction(user, auctionId);

    const selectors = await this.prismaService.forbiddenSelector.findMany({
      where: { auctionId },
    });

    if (user.role === Roles.SuperAdmin) return selectors;

    if (canPurchase(user)) {
      return selectors.filter(selector => selector.isBuyAction === false);
    }
    return selectors;
  }

  async getAllowedPath(id: string, user: AccessUser) {
    await this.access.assertCanAccessAuction(user, id);
    const paths = await this.prismaService.allowedRoute.findMany({ where: { auctionId: id } });
    return paths;
  }
}