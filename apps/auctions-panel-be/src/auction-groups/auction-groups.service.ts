import { Injectable, NotFoundException } from '@nestjs/common';
import { Roles, User } from '@prisma/client';

import { AccessService, type AccessUser } from '../access/access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuctionGroupDto } from './dto/create-auction-group.dto';
import { UpdateAuctionGroupDto } from './dto/update-auction-group.dto';

@Injectable()
export class AuctionGroupsService {
  constructor(
    private prisma: PrismaService,
    private access: AccessService
  ) { }

  private withCounts(data: any | any[]) {
    if (!data) return data;

    const formatGroup = (group: any) => ({
      ...group,
      auctionsCount: group._count?.auctions ?? 0,
      sessionsCount: group._count?.sessions ?? 0,
    });

    if (Array.isArray(data)) {
      return data.map(formatGroup);
    }
    return formatGroup(data);
  }

  async create(createAuctionGroupDto: CreateAuctionGroupDto, user: User) {
    const { auctions, ...rest } = createAuctionGroupDto;

    const isSuperAdmin = user?.role === Roles.SuperAdmin;
    if (!isSuperAdmin) {
      delete createAuctionGroupDto.sessionLimit;
    }

    return this.prisma.auctionGroup.create({
      data: {
        ...rest,
        ...(auctions && {
          auctions: {
            connect: auctions.map((id) => ({ id })),
          },
        }),
      },
      include: { auctions: true },
    });
  }

  // SuperAdmin бачить усі групи аукціонів; решта - лише дозволені їхній групі користувачів.
  // Вкладені аукціони та їх кількість - лише явно дозволені (не всі аукціони групи).
  private async readQuery(user: AccessUser) {
    const auctionWhere = await this.access.auctionWhere(user);
    return {
      where: await this.access.auctionGroupWhere(user),
      include: {
        auctions: { where: auctionWhere },
        // Для ліміту сесій показуємо саме активні сесії групи.
        _count: { select: { auctions: { where: auctionWhere }, sessions: { where: { isActive: true } } } },
      },
    };
  }

  async findAll(user: AccessUser) {
    const { where, include } = await this.readQuery(user);

    const groups = await this.prisma.auctionGroup.findMany({
      where,
      include,
      orderBy: { title: 'asc' },
    });

    return this.withCounts(groups);
  }

  async findOne(id: string, user: AccessUser) {
    const { where, include } = await this.readQuery(user);

    const group = await this.prisma.auctionGroup.findFirst({
      where: { AND: [{ id }, where] },
      include,
    });

    if (!group) {
      throw new NotFoundException('Група аукціонів не знайдена');
    }

    return this.withCounts(group);
  }

  async update(id: string, updateAuctionGroupDto: UpdateAuctionGroupDto, user: User) {
    const isSuperAdmin = user?.role === Roles.SuperAdmin;
    if (!isSuperAdmin) {
      delete updateAuctionGroupDto.sessionLimit;
    }

    const { auctions, ...rest } = updateAuctionGroupDto;

    return this.prisma.auctionGroup.update({
      where: { id },
      data: {
        ...rest,
        ...(auctions && {
          auctions: { set: auctions.map((id) => ({ id })) },
        }),
      },
      include: { auctions: true },
    });
  }

  async remove(id: string) {
    return this.prisma.auctionGroup.delete({ where: { id } });
  }

  async search(user: AccessUser, query?: string) {
    const { where, include } = await this.readQuery(user);

    const groups = await this.prisma.auctionGroup.findMany({
      where: {
        AND: [where, query ? { title: { contains: query, mode: 'insensitive' } } : {}],
      },
      include,
      orderBy: { title: 'asc' },
    });

    return this.withCounts(groups);
  }

  async addAuction(groupId: string, auctionId: string) {
    const group = await this.prisma.auctionGroup.findUnique({
      where: { id: groupId },
      include: { auctions: true },
    });

    if (!group) {
      throw new NotFoundException('Групу аукціонів не знайдено');
    }

    const alreadyAdded = group.auctions.some((a) => a.id === auctionId);
    if (alreadyAdded) return group;

    return this.prisma.auctionGroup.update({
      where: { id: groupId },
      data: { auctions: { connect: { id: auctionId } } },
    });
  }

  async removeAuction(groupId: string, auctionId: string) {
    const group = await this.prisma.auctionGroup.findUnique({
      where: { id: groupId },
      include: { auctions: true },
    });

    if (!group) {
      throw new NotFoundException('Групу аукціонів не знайдено');
    }

    const isAttached = group.auctions.some((a) => a.id === auctionId);
    if (!isAttached) return group;

    return this.prisma.auctionGroup.update({
      where: { id: groupId },
      data: { auctions: { disconnect: { id: auctionId } } },
    });
  }
}