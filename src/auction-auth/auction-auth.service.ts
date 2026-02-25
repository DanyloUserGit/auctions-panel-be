import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hashPassword } from 'src/utils/password';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuctionAuthDto } from './dto/create-auction-auth.dto';
import { UpdateAuctionAuthDto } from './dto/update-auction-auth.dto';

@Injectable()
export class AuctionAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAuctionAuthDto) {
    const hashedPassword = await hashPassword(dto.password);

    try {
      return await this.prisma.auctionAuth.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          auctionId: dto.auctionId,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Користувач з таким email вже існує для цього аукціону');
      }
      throw error;
    }
  }

  async findAll(auctionId: string) {
    return this.prisma.auctionAuth.findMany({
      where: { auctionId },
      orderBy: { email: 'asc' },
    });
  }

  async findOne(id: string) {
    const auth = await this.prisma.auctionAuth.findUnique({
      where: { id },
    });

    if (!auth) {
      throw new NotFoundException('AuctionAuth не знайдено');
    }

    return auth;
  }

  async update(id: string, dto: UpdateAuctionAuthDto) {
    const existing = await this.prisma.auctionAuth.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('AuctionAuth не знайдено');
    }

    const data: any = { ...dto };

    if (dto.password) {
      data.password = await hashPassword(dto.password);
    }

    try {
      return await this.prisma.auctionAuth.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Такий email вже використовується');
      }
      throw error;
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.auctionAuth.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('AuctionAuth не знайдено');
    }

    await this.prisma.auctionAuth.delete({
      where: { id },
    });

    return { message: 'AuctionAuth успішно видалено' };
  }
}
