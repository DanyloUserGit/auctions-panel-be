import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { User } from '@prisma/client';
import { AccessService, type AccessUser } from '../access/access.service';
import { PrismaService } from '../prisma/prisma.service';
import { encryptData } from '../utils/encrypt';
import { SAFE_AUTH_SELECT, accountSelectFor } from './auction-auth.select';
import { CreateAuctionAuthDto } from './dto/create-auction-auth.dto';
import { UpdateAuctionAuthDto } from './dto/update-auction-auth.dto';

export { SAFE_AUTH_SELECT };

@Injectable()
export class AuctionAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService
  ) { }

  // Створення/редагування/видалення акаунтів - лише SuperAdmin (RolesGuard у контролері).
  // Новий акаунт не додається до жодної групи користувачів автоматично.
  async create(dto: CreateAuctionAuthDto) {
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

  // Лише акаунти, явно дозволені користувачу (через групу або особисто) у доступному аукціоні.
  // Логін (email) повертається лише SuperAdmin; при вимкненому showAccounts - лише акаунти із запущеною сесією.
  async findAll(auctionId: string, user: AccessUser) {
    await this.access.assertCanAccessAuction(user, auctionId);

    return this.prisma.auctionAuth.findMany({
      where: { AND: [{ auctionId }, await this.access.visibleAccountWhere(user)] },
      select: accountSelectFor(user.role),
      orderBy: { email: 'asc' },
    });
  }

  private async assertAccountAllowedForUser(user: AccessUser, accountId: string) {
    const exists = await this.prisma.auctionAuth.count({ where: { id: accountId } });
    if (!exists) {
      throw new NotFoundException('Акаунт не знайдено');
    }

    await this.access.assertCanUseAccount(user, accountId);
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

    // Обрані акаунти, до яких доступ уже відкликано, не повертаються.
    const userS = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        selectedAccounts: {
          where: await this.access.visibleAccountWhere(user),
          select: accountSelectFor(user.role),
        },
      },
    });
    return userS?.selectedAccounts ?? [];
  }

  async findOne(id: string) {
    const auth = await this.prisma.auctionAuth.findUnique({
      where: { id },
      select: SAFE_AUTH_SELECT,
    });

    if (!auth) {
      throw new NotFoundException('AuctionAuth не знайдено');
    }

    return auth;
  }

  async update(id: string, dto: UpdateAuctionAuthDto) {
    const existing = await this.prisma.auctionAuth.count({ where: { id } });

    if (!existing) {
      throw new NotFoundException('AuctionAuth не знайдено');
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

  async remove(id: string) {
    const existing = await this.prisma.auctionAuth.count({ where: { id } });

    if (!existing) {
      throw new NotFoundException('AuctionAuth не знайдено');
    }

    await this.prisma.auctionAuth.delete({
      where: { id },
    });

    return { message: 'AuctionAuth успішно видалено' };
  }
}