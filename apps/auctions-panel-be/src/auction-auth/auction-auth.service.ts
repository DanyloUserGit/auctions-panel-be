import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { Roles, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { encryptData } from '../utils/encrypt';
import { CreateAuctionAuthDto } from './dto/create-auction-auth.dto';
import { UpdateAuctionAuthDto } from './dto/update-auction-auth.dto';

type AuthUser = {
  id: string;
  role: Roles;
  auctionGroupId?: string | null;
  managedGroup?: { id: string } | null;
};

const SAFE_AUTH_SELECT = {
  id: true,
  title: true,
  email: true,
  auctionId: true,
} as const;

@Injectable()
export class AuctionAuthService {
  constructor(private readonly prisma: PrismaService) { }

  private getUserGroupId(user: AuthUser): string | null {
    if (user.role === Roles.Admin) {
      return user.managedGroup?.id ?? null;
    }
    return user.auctionGroupId ?? null;
  }

  private async assertAuctionGroupAccess(user: AuthUser, auctionId: string) {
    if (user.role === Roles.SuperAdmin) return;
    // if (user.role !== Roles.Admin) {
    //   throw new ForbiddenException('Недостатньо прав');
    // }
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { auctionGroupId: true },
    });
    const userGroupId = this.getUserGroupId(user);
    if (!auction || !userGroupId || auction.auctionGroupId !== userGroupId) {
      throw new ForbiddenException('Немає доступу до аукціонів іншої групи');
    }
  }

  async create(dto: CreateAuctionAuthDto, adminUser: AuthUser) {
    await this.assertAuctionGroupAccess(adminUser, dto.auctionId);

    const hashedPassword = encryptData(dto.password);

    try {
      return await this.prisma.auctionAuth.create({
        data: {
          title: dto.title,
          email: dto.email,
          password: hashedPassword,
          auctionId: dto.auctionId,
        },
        select: SAFE_AUTH_SELECT,
      });
    } catch (error) {
      if ((error as any).code === 'P2002') {
        throw new ConflictException('Користувач з таким email вже існує для цього аукціону');
      }
      throw error;
    }
  }

  async findAll(auctionId: string, adminUser: AuthUser) {
    await this.assertAuctionGroupAccess(adminUser, auctionId);

    return this.prisma.auctionAuth.findMany({
      where: { auctionId },
      select: SAFE_AUTH_SELECT,
      orderBy: { email: 'asc' },
    });
  }

  private async assertAccountAllowedForUser(user: AuthUser, accountId: string) {
    const account = await this.prisma.auctionAuth.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        auction: {
          select: {
            auctionGroupId: true,
            users: { select: { id: true } },
          },
        },
      },
    });

    if (!account) {
      throw new NotFoundException('Акаунт не знайдено');
    }

    if (user.role === Roles.SuperAdmin) return account;

    const explicitlyAllowed = account.auction.users.some((u) => u.id === user.id);
    const userGroupId = this.getUserGroupId(user);
    const sameGroup = !!userGroupId && userGroupId === account.auction.auctionGroupId;

    if (!explicitlyAllowed && !sameGroup) {
      throw new ForbiddenException('Цей акаунт вам не дозволено використовувати');
    }

    return account;
  }

  async selectAccount(accountId: string, user: User) {
    if (!user) throw new UnauthorizedException('Користувач не знайдений');

    await this.assertAccountAllowedForUser(user, accountId);

    const userS = await this.prisma.user.findUnique({ where: { id: user.id }, include: { selectedAccounts: true } });
    if (!userS) throw new NotFoundException('Користувача не знайдено');

    const alreadyAdded = userS.selectedAccounts.some((u) => u.id === accountId);

    if (alreadyAdded) return { status: true };

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        selectedAccounts: {
          connect: { id: accountId },
        },
      },
    });

    return { status: true };
  }

  async removeAccount(accountId: string, user: User) {
    if (!user) throw new UnauthorizedException('Користувач не знайдений');
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

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        selectedAccounts: {
          disconnect: { id: accountId },
        },
      },
    });

    return { status: true };
  }

  async getSelectedAccounts(user: User) {
    if (!user) throw new UnauthorizedException('Користувач не знайдений');

    const userS = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        selectedAccounts: { select: SAFE_AUTH_SELECT },
      },
    });
    return userS?.selectedAccounts ?? [];
  }

  async findOne(id: string, adminUser: AuthUser) {
    const auth = await this.prisma.auctionAuth.findUnique({
      where: { id },
      select: { ...SAFE_AUTH_SELECT, auction: { select: { auctionGroupId: true } } },
    });

    if (!auth) {
      throw new NotFoundException('AuctionAuth не знайдено');
    }
    if (adminUser.role !== Roles.SuperAdmin && auth.auction.auctionGroupId !== this.getUserGroupId(adminUser)) {
      throw new ForbiddenException('Немає доступу до акаунта іншої групи');
    }

    const { auction, ...rest } = auth;
    return rest;
  }

  async update(id: string, dto: UpdateAuctionAuthDto, adminUser: AuthUser) {
    const existing = await this.prisma.auctionAuth.findUnique({
      where: { id },
      select: { auctionId: true, auction: { select: { auctionGroupId: true } } },
    });

    if (!existing) {
      throw new NotFoundException('AuctionAuth не знайдено');
    }

    if (adminUser.role !== Roles.SuperAdmin && existing.auction.auctionGroupId !== this.getUserGroupId(adminUser)) {
      throw new ForbiddenException('Немає доступу до акаунта іншої групи');
    }

    const data: any = { ...dto };

    if (dto.password) {
      data.password = encryptData(dto.password);
    }

    try {
      return await this.prisma.auctionAuth.update({
        where: { id },
        data,
        select: SAFE_AUTH_SELECT,
      });
    } catch (error) {
      if ((error as any).code === 'P2002') {
        throw new ConflictException('Такий email вже використовується');
      }
      throw error;
    }
  }

  async remove(id: string, adminUser: AuthUser) {
    const existing = await this.prisma.auctionAuth.findUnique({
      where: { id },
      select: { auction: { select: { auctionGroupId: true } } },
    });

    if (!existing) {
      throw new NotFoundException('AuctionAuth не знайдено');
    }

    if (adminUser.role !== Roles.SuperAdmin && existing.auction.auctionGroupId !== this.getUserGroupId(adminUser)) {
      throw new ForbiddenException('Немає доступу до акаунта іншої групи');
    }

    await this.prisma.auctionAuth.delete({
      where: { id },
    });

    return { message: 'AuctionAuth успішно видалено' };
  }
}