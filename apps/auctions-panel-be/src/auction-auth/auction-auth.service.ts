import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { encryptData } from '../utils/encrypt';
import { hashPassword } from '../utils/password';
import { CreateAuctionAuthDto } from './dto/create-auction-auth.dto';
import { UpdateAuctionAuthDto } from './dto/update-auction-auth.dto';
import { User } from '@prisma/client';

@Injectable()
export class AuctionAuthService {
  constructor(private readonly prisma: PrismaService) { }

  async create(dto: CreateAuctionAuthDto) {
    const hashedPassword = encryptData(dto.password);

    try {
      return await this.prisma.auctionAuth.create({
        data: {
          title:dto.title,
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

  async selectAccount(accountId: string, user: User) {
    try {
      if(!user) throw new UnauthorizedException("Користувач не знайдений");
      const userS = await this.prisma.user.findUnique({ where: { id: user.id }, include: { selectedAccounts: true } });
      if (!userS) throw new NotFoundException("Користувача не знайдено");

      const alreadyAdded = userS.selectedAccounts.some((u) => u.id === accountId);

      if (alreadyAdded) return { status: true };

      return await this.prisma.user.update({
        where: { id: user.id },
        data: {
          selectedAccounts: {
            connect: { id: accountId },
          },
        },
      });
    } catch (error) {
      throw error;
    }
  }

  async removeAccount(accountId: string, user: User) {
    if(!user) throw new UnauthorizedException("Користувач не знайдений");
    const userS = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { selectedAccounts: true },
    });

    if (!userS) {
      throw new NotFoundException('Користувача не знайдено');
    }

    const isAttached = userS.selectedAccounts.some((u) => u.id === accountId);

    if (!isAttached) {
      return { status: true };
    }

    return await this.prisma.user.update({
      where: { id: user.id },
      data: {
        selectedAccounts: {
          disconnect: { id: accountId },
        },
      },
    });
  }

  async getSelectedAccounts(user: User) {
    try {
      if (!user) throw new UnauthorizedException("Користувач не знайдений");
      const userS = await this.prisma.user.findUnique({ where: { id: user.id }, include: { selectedAccounts: true } });
      return userS?.selectedAccounts ?? [];
    } catch (error) {
      throw error;
    }
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
