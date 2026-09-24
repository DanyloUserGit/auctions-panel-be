import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Roles } from '@prisma/client';
import { accountSelectFor } from '../auction-auth/auction-auth.select';
import { PrismaService } from '../prisma/prisma.service';

export type AccessUser = { id: string; role: Roles };

// Хто отримує доступ: сам користувач (особисті дозволи) та його активна група (якщо є).
// hideAccounts - у групи вимкнено showAccounts, а користувач має роль User.
type Principal = { userId: string; userGroupId: string | null; hideAccounts: boolean };

// Ланцюг доступу: AuctionGroup → Auction → AuctionAuth (акаунт).
// Кожен рівень має бути явно дозволений - групі користувача АБО особисто користувачу:
//   1. AuctionGroup дозволена;
//   2. Auction дозволений І його AuctionGroup доступна (п.1);
//   3. AuctionAuth дозволений І його Auction доступний (п.2).
// Дозвіл батьківського рівня НЕ відкриває дочірні автоматично.
// Заблокована група закриває доступ її учасникам повністю (і особисті дозволи теж).
// Акаунт, який GA/SA заборонив конкретному учаснику (deniedAccounts), не діє для нього через групу;
// особистий дозвіл від SA при цьому зберігається.
// SuperAdmin має доступ до всього.
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) { }

  // Умова "нічого": використовується, коли доступу немає взагалі.
  private static readonly NOTHING = { id: { in: [] as string[] } };

  private static grantedAuctionGroupWhere(p: Principal): Prisma.AuctionGroupWhereInput {
    return {
      OR: [
        ...(p.userGroupId ? [{ allowedForUserGroups: { some: { id: p.userGroupId } } }] : []),
        { allowedForUsers: { some: { id: p.userId } } },
      ],
    };
  }

  private static reachableAuctionsWhere(p: Principal): Prisma.AuctionWhereInput {
    return {
      AND: [
        {
          OR: [
            ...(p.userGroupId ? [{ allowedForGroups: { some: { id: p.userGroupId } } }] : []),
            { allowedForUsers: { some: { id: p.userId } } },
          ],
        },
        { auctionGroup: AccessService.grantedAuctionGroupWhere(p) },
      ],
    };
  }

  private static reachableAccountsWhere(p: Principal): Prisma.AuctionAuthWhereInput {
    return {
      AND: [
        {
          OR: [
            ...(p.userGroupId
              ? [
                {
                  allowedForUserGroups: { some: { id: p.userGroupId } },
                  deniedForUsers: { none: { id: p.userId } },
                },
              ]
              : []),
            { allowedForUsers: { some: { id: p.userId } } },
          ],
        },
        { auction: AccessService.reachableAuctionsWhere(p) },
      ],
    };
  }

  // null - доступу немає (група користувача заблокована).
  private async getPrincipal(user: AccessUser): Promise<Principal | null> {
    const group = await this.getUserGroup(user);
    if (group && !group.isActive) return null;
    return {
      userId: user.id,
      userGroupId: group?.id ?? null,
      hideAccounts: user.role === Roles.User && !!group && !group.showAccounts,
    };
  }

  private async getUserGroup(user: AccessUser) {
    return user.role === Roles.Admin
      ? this.prisma.userGroup.findUnique({
        where: { AdminId: user.id },
        select: { id: true, isActive: true, showAccounts: true },
      })
      : (
        await this.prisma.user.findUnique({
          where: { id: user.id },
          select: { userGroup: { select: { id: true, isActive: true, showAccounts: true } } },
        })
      )?.userGroup;
  }

  static allowedAuctionGroupsWhere(userGroupId: string): Prisma.AuctionGroupWhereInput {
    return { allowedForUserGroups: { some: { id: userGroupId } } };
  }

  static allowedAuctionsWhere(userGroupId: string): Prisma.AuctionWhereInput {
    return {
      allowedForGroups: { some: { id: userGroupId } },
      auctionGroup: AccessService.allowedAuctionGroupsWhere(userGroupId),
    };
  }

  static allowedAccountsWhere(userGroupId: string): Prisma.AuctionAuthWhereInput {
    return {
      allowedForUserGroups: { some: { id: userGroupId } },
      auction: AccessService.allowedAuctionsWhere(userGroupId),
    };
  }

  // Активна група береться з БД (не з даних запиту): для Admin - група, якою він керує,
  // для User - група, до якої він належить. Неактивна група = null.
  async getActiveUserGroupId(user: AccessUser): Promise<string | null> {
    const group = await this.getUserGroup(user);
    return group?.isActive ? group.id : null;
  }

  async auctionGroupWhere(user: AccessUser): Promise<Prisma.AuctionGroupWhereInput> {
    if (user.role === Roles.SuperAdmin) return {};
    const principal = await this.getPrincipal(user);
    return principal ? AccessService.grantedAuctionGroupWhere(principal) : AccessService.NOTHING;
  }

  async auctionWhere(user: AccessUser): Promise<Prisma.AuctionWhereInput> {
    if (user.role === Roles.SuperAdmin) return {};
    const principal = await this.getPrincipal(user);
    return principal ? AccessService.reachableAuctionsWhere(principal) : AccessService.NOTHING;
  }

  async accountWhere(user: AccessUser): Promise<Prisma.AuctionAuthWhereInput> {
    if (user.role === Roles.SuperAdmin) return {};
    const principal = await this.getPrincipal(user);
    return principal ? AccessService.reachableAccountsWhere(principal) : AccessService.NOTHING;
  }

  // Акаунти, які користувачу показуються у списках. Якщо групі вимкнено showAccounts,
  // учасник (роль User) бачить лише доступні акаунти із запущеною сесією - щоб приєднатися до неї.
  async visibleAccountWhere(user: AccessUser): Promise<Prisma.AuctionAuthWhereInput> {
    if (user.role === Roles.SuperAdmin) return {};
    const principal = await this.getPrincipal(user);
    if (!principal) return AccessService.NOTHING;

    const reachable = AccessService.reachableAccountsWhere(principal);
    return principal.hideAccounts
      ? { AND: [reachable, { sessions: { some: { isActive: true } } }] }
      : reachable;
  }

  // Запуск НОВОЇ сесії (не приєднання до запущеної) заборонено учасникам груп із вимкненим showAccounts.
  async canStartNewSession(user: AccessUser): Promise<boolean> {
    if (user.role === Roles.SuperAdmin) return true;
    const principal = await this.getPrincipal(user);
    return !!principal && !principal.hideAccounts;
  }

  async getAccessibleAuctionGroups(user: AccessUser) {
    return this.prisma.auctionGroup.findMany({
      where: await this.auctionGroupWhere(user),
      orderBy: { title: 'asc' },
    });
  }

  async getAccessibleAuctions(user: AccessUser) {
    return this.prisma.auction.findMany({
      where: await this.auctionWhere(user),
      orderBy: { title: 'asc' },
    });
  }

  async getAccessibleAccounts(user: AccessUser) {
    return this.prisma.auctionAuth.findMany({
      where: await this.visibleAccountWhere(user),
      select: accountSelectFor(user.role),
      orderBy: { email: 'asc' },
    });
  }

  async canAccessAuctionGroup(user: AccessUser, auctionGroupId: string): Promise<boolean> {
    if (user.role === Roles.SuperAdmin) return true;
    const count = await this.prisma.auctionGroup.count({
      where: { AND: [{ id: auctionGroupId }, await this.auctionGroupWhere(user)] },
    });
    return count > 0;
  }

  async canAccessAuction(user: AccessUser, auctionId: string): Promise<boolean> {
    if (user.role === Roles.SuperAdmin) return true;
    const count = await this.prisma.auction.count({
      where: { AND: [{ id: auctionId }, await this.auctionWhere(user)] },
    });
    return count > 0;
  }

  async canUseAccount(user: AccessUser, accountId: string): Promise<boolean> {
    if (user.role === Roles.SuperAdmin) return true;
    const count = await this.prisma.auctionAuth.count({
      where: { AND: [{ id: accountId }, await this.accountWhere(user)] },
    });
    return count > 0;
  }

  async assertCanAccessAuctionGroup(user: AccessUser, auctionGroupId: string) {
    if (!(await this.canAccessAuctionGroup(user, auctionGroupId))) {
      throw new ForbiddenException('Немає доступу до цієї групи аукціонів');
    }
  }

  async assertCanAccessAuction(user: AccessUser, auctionId: string) {
    if (!(await this.canAccessAuction(user, auctionId))) {
      throw new ForbiddenException('Немає доступу до цього аукціону');
    }
  }

  async assertCanUseAccount(user: AccessUser, accountId: string) {
    if (!(await this.canUseAccount(user, accountId))) {
      throw new ForbiddenException('Цей акаунт вам не дозволено використовувати');
    }
  }
}
