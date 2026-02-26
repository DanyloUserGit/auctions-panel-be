import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Roles } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateAuctionGroupDto } from './dto/create-auction-group.dto';
import { UpdateAuctionGroupDto } from './dto/update-auction-group.dto';

@Injectable()
export class AuctionGroupsService {
  constructor(private prisma: PrismaService) {}

  async create(createAuctionGroupDto: CreateAuctionGroupDto) {
    const { auctions, ...rest } = createAuctionGroupDto;

    return await this.prisma.auctionGroup.create({
      data: {
        ...rest,

        ...(auctions && {
          auctions: {
            connect: auctions.map((id) => ({ id })),
          },
        }),
      },
      include: {
        auctions: true,
      },
    });
  }

  async findAll(user?: { id: string; role: Roles }) {
    if (!user?.id) return [];

    if (user?.role === Roles.SuperAdmin) {
      return this.prisma.auctionGroup.findMany({
        include: {
          auctions: true
        },
      });
    }

    return this.prisma.auctionGroup.findMany({
      where: {
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
      },
    });
  }

  async findOne(id: string, user?: { id: string; role: Roles }) {
    if (!user?.id) {
      throw new ForbiddenException('Потрібна авторизація');
    }

    if (user?.role === Roles.Admin) {
      const auction = await this.prisma.auctionGroup.findUnique({
        where: { id },
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
        },
      });

      if (!auction) {
        throw new NotFoundException('Група аукціонів не знайдена');
      }

      return auction;
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
      },
    });

    if (!group) {
      throw new NotFoundException('Група аукціонів не знайдена або немає доступу');
    }

    return group;
  }

  async update(id: string, updateAuctionGroupDto: UpdateAuctionGroupDto) {
    const { auctions, ...rest } = updateAuctionGroupDto;

    return await this.prisma.auctionGroup.update({
      where: { id },
      data: {
        ...rest,

        ...(auctions && {
          auctions: {
            set: auctions.map((id) => ({ id })),
          },
        }),
      },
      include: {
        auctions: true,
      },
    });
  }

  async remove(id: string) {
    return await this.prisma.auctionGroup.delete({
      where: { id },
    });
  }
  async search(params: { user?: { id: string; role: Roles }; query?: string }) {
    const { user, query } = params;
    const isAdmin = user?.role === Roles.Admin;

    return this.prisma.auctionGroup.findMany({
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
      },
      orderBy: { title: 'asc' },
    });
  }
  async addAuction(groupId: string, userId: string) {
    const group = await this.prisma.auctionGroup.findUnique({
      where: { id: groupId },
      include: { auctions: true },
    });

    const alreadyAdded = group?.auctions.some((u) => u.id === userId);

    if (alreadyAdded) return group;

    return await this.prisma.auctionGroup.update({
      where: { id: groupId },
      data: {
        auctions: {
          connect: { id: userId },
        },
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
      },
    });
  }
}
