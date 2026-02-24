import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
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

  async findAll() {
    return await this.prisma.auctionGroup.findMany({
      include: {
        auctions: true,
      },
    });
  }

  async findOne(id: string) {
    const group = await this.prisma.auctionGroup.findUnique({
      where: { id },
      include: {
        auctions: true,
      },
    });

    if (!group) {
      throw new NotFoundException('AuctionGroup not found');
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
}
