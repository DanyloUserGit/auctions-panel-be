import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Roles } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddPathDto } from './dto/add-path.dto';
import { AddSelectorDto } from './dto/add-selector.dto';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

@Injectable()
export class AuctionsService {
  constructor(private prismaService: PrismaService) { }

  async create(createAuctionDto: CreateAuctionDto) {
    const { users, sessions, auctionAuths, auctionGroupId, ...rest } = createAuctionDto;

    const auction = await this.prismaService.auction.create({
      data: {
        ...rest,

        ...(auctionGroupId && {
          auctionGroup: {
            connect: { id: auctionGroupId },
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

  async findAll(groupId: string, user?: { id: string; role: Roles }) {
    if (!user?.id) return [];
    const isAdmin = user?.role === Roles.Admin || user?.role === Roles.SuperAdmin;
    if (isAdmin) {
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

    return this.prismaService.auction.findMany({
      where: {
        users: {
          some: { id: user.id },
        },
        auctionGroupId: groupId,
      },
      include: {
        users: true,
        sessions: true,
        auctionAuths: true,
        auctionGroup: true,
      },
    });
  }

  async findOne(id: string, user?: { id: string; role: Roles }) {
    if (!user?.id) {
      throw new ForbiddenException('Потрібна авторизація');
    }
    const isAdmin = user?.role === Roles.Admin || user?.role === Roles.SuperAdmin;
    if (isAdmin) {
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

    const auction = await this.prismaService.auction.findFirst({
      where: {
        id,
        users: {
          some: { id: user.id },
        },
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

  async update(id: string, updateAuctionDto: UpdateAuctionDto) {
    const { users, sessions, auctionAuths, auctionGroupId, ...rest } = updateAuctionDto;

    try {
      return await this.prismaService.auction.update({
        where: { id },
        data: {
          ...rest,

          ...(auctionGroupId !== undefined && {
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
  async remove(id: string) {
    return await this.prismaService.auction.delete({
      where: { id },
    });
  }
  async addUser(auctionId: string, userId: string) {
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
  async removeUser(auctionId: string, userId: string) {
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
    user?: { id: string; role: Roles };
    query?: string;
    auctionGroupId?: string;
  }) {
    const { user, query, auctionGroupId } = params;

    const isAdmin = user?.role === Roles.Admin || user?.role === Roles.SuperAdmin;
    console.log(user, query, auctionGroupId, isAdmin);
    return this.prismaService.auction.findMany({
      where: {
        AND: [
          query
            ? {
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
            }
            : {},

          auctionGroupId ? { auctionGroupId } : {},

          !isAdmin
            ? {
              users: {
                some: { id: user?.id },
              },
            }
            : {},
        ],
      },
      include: {
        auctionGroup: true,
      },
      orderBy: { title: 'asc' },
    });
  }

  async addSelector(auctionId: string, body: AddSelectorDto) {
    try {
      const selector = await this.prismaService.forbiddenSelector.create({
        data: {
          ...body,
          auction: {
            connect: { id: auctionId },
          },
        }
      })
      return selector;
    } catch (error) {
      throw error;
    }
  }
  async addPathAllowed(auctionId: string, body: AddPathDto) {
    try {
      const allowed = await this.prismaService.allowedRoute.create({
        data: {
          ...body,
          auction: {
            connect: { id: auctionId },
          },
        }
      })
      return allowed;
    } catch (error) {
      throw error;
    }
  }
  async addPathForbidden(auctionId: string, body: AddPathDto) {
    try {
      const forbidden = await this.prismaService.forbiddenRoute.create({
        data: {
          ...body,
          auction: {
            connect: { id: auctionId },
          },
        }
      })
      return forbidden;
    } catch (error) {
      throw error;
    }
  }
  async deletePathAllowed(allowedId: string) {
    try {
      await this.prismaService.allowedRoute.deleteMany({
        where: {
          id: allowedId
        }
      })
      return { status: true }
    } catch (error) {
      throw error;
    }
  }
  async deletePathForbidden(id: string) {
    try {
      await this.prismaService.forbiddenRoute.deleteMany({
        where: {
          id
        }
      })
      return { status: true }
    } catch (error) {
      throw error;
    }
  }

  async deleteSelector(id: string) {
    try {
      await this.prismaService.forbiddenSelector.deleteMany({
        where: {
          id
        }
      })
      return { status: true }
    } catch (error) {
      throw error;
    }
  }
  async getForbiddenPath() {
    try {
      const paths = await this.prismaService.forbiddenRoute.findMany();
      return paths;
    } catch (error) {
      throw error;
    }
  }
  async getForbiddenSelector() {
    try {
      const selectors = await this.prismaService.forbiddenSelector.findMany();
      return selectors;
    } catch (error) {
      throw error;
    }
  }
  async getAllowedPath() {
    try {
      const paths = await this.prismaService.allowedRoute.findMany();
      return paths;
    } catch (error) {
      throw error;
    }
  }
}
