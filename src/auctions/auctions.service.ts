import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';

@Injectable()
export class AuctionsService {
  constructor(private prismaService: PrismaService) {}

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

  async findAll() {
    return await this.prismaService.auction.findMany({
      include: {
        users: true,
        sessions: true,
        auctionAuths: true,
        auctionGroup: true,
      },
    });
  }

  async findOne(id: string) {
    return await this.prismaService.auction.findUnique({
      where: { id },
      include: {
        users: true,
        sessions: true,
        auctionAuths: true,
        auctionGroup: true,
      },
    });
  }

  async update(id: string, updateAuctionDto: UpdateAuctionDto) {
    const { users, sessions, auctionAuths, auctionGroupId, ...rest } = updateAuctionDto;

    return await this.prismaService.auction.update({
      where: { id },
      data: {
        ...rest,

        ...(auctionGroupId !== undefined && {
          auctionGroup: auctionGroupId ? { connect: { id: auctionGroupId } } : { disconnect: true },
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
}
