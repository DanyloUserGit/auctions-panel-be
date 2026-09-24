import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Roles, User } from '@prisma/client';
import { accountSelectFor } from '../auction-auth/auction-auth.select';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../utils/password';
import { CreateUserDto } from './dto/create-user.dto';
import { SearchUserDto } from './dto/search-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

// req.user, який повертає JwtStrategy (findOne), містить managedGroup.
type RequestUser = Pick<User, 'id' | 'role'> & { managedGroup?: { id: string } | null };

type TargetUser = Pick<User, 'id' | 'role' | 'rights' | 'email' | 'sessionLimit' | 'userGroupId'> & {
  managedGroup?: { id: string } | null;
};

export type PersonalAccessKind = 'auctionGroup' | 'auction' | 'account';

const PERSONAL_ACCESS_RELATION = {
  auctionGroup: 'personalAuctionGroups',
  auction: 'personalAuctions',
  account: 'personalAccounts',
} as const;

// Батьківські рівні включено, щоб дерево доступу можна було побудувати лише з цих даних.
// Логін (email) акаунта - лише для SuperAdmin.
const accountWithParentsSelect = (role: Roles) => ({
  ...accountSelectFor(role),
  auction: { select: { id: true, title: true, auctionGroupId: true, auctionGroup: { select: { id: true, title: true } } } },
});

const personalAccessSelect = (role: Roles) => ({
  personalAuctionGroups: { select: { id: true, title: true } },
  personalAuctions: {
    select: { id: true, title: true, url: true, auctionGroupId: true, auctionGroup: { select: { id: true, title: true } } },
  },
  personalAccounts: { select: accountWithParentsSelect(role) },
  deniedAccounts: { select: accountWithParentsSelect(role) },
});

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private readonly notificationService: NotificationService) { }

  // Admin (GroupAdmin) керує лише користувачами з роллю User у своїй групі (managedGroup).
  private isManagedMember(currentUser: RequestUser, target: Pick<User, 'role' | 'userGroupId'>) {
    const managedGroupId = currentUser.role === Roles.Admin ? currentUser.managedGroup?.id : null;
    return !!managedGroupId && target.role === Roles.User && target.userGroupId === managedGroupId;
  }

  private assertCanUpdateUser(currentUser: RequestUser, target: TargetUser, dto: UpdateUserDto) {
    if (currentUser.role === Roles.SuperAdmin) return;

    const isSelf = currentUser.id === target.id;
    const isManagedMember = this.isManagedMember(currentUser, target);

    if (!isSelf && !isManagedMember) {
      throw new ForbiddenException('У вас немає прав редагувати цього користувача');
    }

    if (dto.role !== undefined && dto.role !== target.role) {
      throw new ForbiddenException('Змінювати роль може лише SuperAdmin');
    }
    if (dto.userGroupId !== undefined && dto.userGroupId !== target.userGroupId) {
      throw new ForbiddenException('Змінювати групу користувача може лише SuperAdmin');
    }
    if (dto.managedGroup !== undefined && dto.managedGroup !== target.managedGroup?.id) {
      throw new ForbiddenException('Призначати адміністратора групи може лише SuperAdmin');
    }

    // Власні права та ліміт сесій змінює лише вищий адміністратор.
    if (!isManagedMember) {
      if (dto.rights !== undefined && dto.rights !== target.rights) {
        throw new ForbiddenException('Недостатньо прав для зміни прав доступу');
      }
      if (dto.sessionLimit !== undefined && dto.sessionLimit !== target.sessionLimit) {
        throw new ForbiddenException('Недостатньо прав для зміни ліміту сесій');
      }
    }
  }

  async create(createUserDto: CreateUserDto, currentUser: RequestUser) {
    let targetGroupId: string | undefined | null = createUserDto.userGroupId;

    if (currentUser.role !== Roles.SuperAdmin) {
      if (currentUser.role !== Roles.Admin) {
        throw new ForbiddenException('Недостатньо прав для створення користувачів');
      }
      if (createUserDto.role !== Roles.User) {
        throw new ForbiddenException('Адміністратор групи може створювати лише користувачів з роллю User');
      }

      const managedGroupId = currentUser.managedGroup?.id;
      if (!managedGroupId) {
        throw new ForbiddenException('Адміністратор без групи не може створювати користувачів');
      }

      // Користувач завжди потрапляє в групу адміністратора, а не в довільну передану.
      targetGroupId = managedGroupId;
      delete createUserDto.managedGroup;
    }

    if (createUserDto.role === Roles.User && !targetGroupId) {
      throw new BadRequestException('Користувач з роллю User має належати до групи користувачів');
    }

    const hashedPassword = await hashPassword(createUserDto.password);

    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
        userGroupId: targetGroupId || null,
        managedGroup: undefined,
      },
    });

    if (createUserDto.managedGroup) {
      await this.prisma.userGroup.update({
        where: { id: createUserDto.managedGroup },
        data: {
          Admin: {
            connect: { id: user.id }
          }
        }
      });
    }
    await this.notificationService.initializeDefaultSettings(user.id);
    return user;
  }

  async getUserControlCard(id: string, currentUser: RequestUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        userGroup: true,
        managedGroup: true,
        session: {
          include: { auction: true },
        },
        refreshTokens: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`Користувач не знайдений`);
    }

    // Картка контролю: сам користувач, SuperAdmin або адміністратор групи цього користувача.
    const isSelf = currentUser.id === user.id;
    if (currentUser.role !== Roles.SuperAdmin && !isSelf && !this.isManagedMember(currentUser, user)) {
      throw new ForbiddenException('У вас немає доступу до цього користувача');
    }

    return {
      profile: {
        id: user.id,
        fullName: `${user.firstName} ${user.lastName}`,
        email: user.email,
        phone: user.phone,
        city: user.city,
        role: user.role,
        userGroup: user.userGroup || null,
        managedGroup: user.managedGroup || null,
      },
      status: {
        isActive: user.isActive,
        isBlocked: user.isBlocked,
        rights: user.rights,
        sessionRights: user.sessionRights,
      },
      activity: {
        lastLogin: user.lastLogin,
        lastActivity: user.lastActivity,
        currentSession: user.session
          ? {
            id: user.session.id,
            auction: user.session.auction.title,
            createdAt: user.session.createdAt,
            expiresAt: user.session.expiresAt,
          }
          : null,
      },
      limits: {
        sessionLimit: user.sessionLimit,
      },
      recentEvents: await this.prisma.refreshToken.findMany({
        where: { userId: id },
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, id: true },
      }),
    };
  }

  // Блокування/видалення: SuperAdmin - будь-кого, Admin - лише User-учасників своєї групи.
  private async assertCanManageUser(id: string, currentUser: RequestUser) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true, userGroupId: true },
    });

    if (!target) {
      throw new NotFoundException(`Користувач з id ${id} не знайдений`);
    }

    if (currentUser.role !== Roles.SuperAdmin && !this.isManagedMember(currentUser, target)) {
      throw new ForbiddenException('У вас немає прав керувати цим користувачем');
    }
  }

  async updateUserStatus(id: string, statusData: UpdateUserStatusDto, currentUser: RequestUser) {
    await this.assertCanManageUser(id, currentUser);

    return await this.prisma.user.update({
      where: { id },
      data: statusData,
    });
  }
  async findAll(user: any) {
    try {
      if (!user) throw new NotFoundException();

      if (user.role === Roles.User) throw new ForbiddenException();

      if (user.role === Roles.Admin) {
        // Admin без керованої групи не має учасників.
        if (!user.managedGroup?.id) return [];
        {
          return await this.prisma.user.findMany({
            where: {
              userGroupId: user.managedGroup.id
            },
            include: { userGroup: { select: { id: true, name: true } } },
          });
        }
      }
      if (user.role === Roles.SuperAdmin) {
        return await this.prisma.user.findMany({
          include: { managedGroup: true, userGroup: { select: { id: true, name: true } } },
        });
      }

      return {};
    } catch (error) {
      throw error;
    }
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        rights: true,
        phone: true,
        city: true,
        isBlocked: true,
        userGroupId: true,
        userGroup: true,
        managedGroup: true
      },
    });
    if (!user) {
      throw new NotFoundException(`Користувач з id ${id} не знайдений`);
    }
    return user;
  }

  // GET /users/:id - сам користувач, SuperAdmin або адміністратор групи цього користувача.
  async findOneForRequester(id: string, currentUser: RequestUser) {
    const user = await this.findOne(id);

    const isSelf = currentUser.id === user.id;
    if (currentUser.role !== Roles.SuperAdmin && !isSelf && !this.isManagedMember(currentUser, user)) {
      throw new ForbiddenException('У вас немає доступу до цього користувача');
    }

    return user;
  }

  // Єдине місце, де потрібен хеш пароля (перевірка логіну) - тому omit знято явно.
  async findOneByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      omit: { password: false },
    });
    if (!user) {
      throw new NotFoundException(`Користувач з id ${email} не знайдений`);
    }
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto, currentUser: RequestUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { managedGroup: { select: { id: true } } },
    });

    if (!user) {
      throw new NotFoundException(`Користувач з id ${id} не знайдений`);
    }

    this.assertCanUpdateUser(currentUser, user, updateUserDto);

    const updateData: any = { ...updateUserDto };

    if (updateData.password) {
      updateData.password = await hashPassword(updateData.password);
    }

    if (updateData.email === user.email) {
      delete updateData.email;
    } else if (updateData.email) {
      const emailExists = await this.prisma.user.findUnique({
        where: { email: updateData.email }
      });

      if (emailExists) {
        throw new BadRequestException('Цей email вже використовується іншим користувачем');
      }
    }

    delete updateData.managedGroup;

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });

    if (updateUserDto.managedGroup !== undefined) {
      if (updateUserDto.managedGroup === null) {
        await this.prisma.userGroup.updateMany({
          where: { AdminId: id },
          data: { AdminId: null }
        });
      } else {
        await this.prisma.userGroup.update({
          where: { id: updateUserDto.managedGroup },
          data: {
            Admin: {
              connect: { id }
            }
          }
        });
      }
    }

    return updatedUser;
  }

  // Особисті дозволи користувача (власний ланцюг група аукціонів → аукціон → акаунт).
  // Перегляд - SuperAdmin або адміністратор групи користувача; змінює лише SuperAdmin (RolesGuard).
  async getPersonalAccess(id: string, currentUser: RequestUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        userGroupId: true,
        userGroup: { select: { canGaManageAccounts: true } },
        ...personalAccessSelect(currentUser.role),
      },
    });

    if (!user) {
      throw new NotFoundException(`Користувач з id ${id} не знайдений`);
    }

    if (currentUser.role !== Roles.SuperAdmin && !this.isManagedMember(currentUser, user)) {
      throw new ForbiddenException('У вас немає доступу до цього користувача');
    }

    return {
      allowedAuctionGroups: user.personalAuctionGroups,
      allowedAuctions: user.personalAuctions,
      allowedAccounts: user.personalAccounts,
      // Акаунти групи, заборонені цьому учаснику (canGaManageAccounts).
      deniedAccounts: user.deniedAccounts,
      canManageDenials:
        currentUser.role === Roles.SuperAdmin ||
        (this.isManagedMember(currentUser, user) && !!user.userGroup?.canGaManageAccounts),
    };
  }

  // Заборона/повернення учаснику акаунта, який надано його групі.
  // SuperAdmin - завжди; GA - лише учасникам своєї групи і лише якщо SuperAdmin увімкнув групі canGaManageAccounts.
  async setDeniedAccount(id: string, accountId: string, deny: boolean, currentUser: RequestUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true, userGroupId: true, userGroup: { select: { canGaManageAccounts: true } } },
    });

    if (!user) {
      throw new NotFoundException(`Користувач з id ${id} не знайдений`);
    }

    const canManage =
      currentUser.role === Roles.SuperAdmin ||
      (this.isManagedMember(currentUser, user) && !!user.userGroup?.canGaManageAccounts);
    if (!canManage) {
      throw new ForbiddenException('Недостатньо прав для керування доступом до акаунтів цього користувача');
    }

    if (deny) {
      const grantedToGroup = user.userGroupId
        ? await this.prisma.auctionAuth.count({
          where: { id: accountId, allowedForUserGroups: { some: { id: user.userGroupId } } },
        })
        : 0;
      if (!grantedToGroup) {
        throw new BadRequestException('Заборонити можна лише акаунт, наданий групі користувача');
      }
    }

    await this.prisma.user.update({
      where: { id },
      data: { deniedAccounts: deny ? { connect: { id: accountId } } : { disconnect: { id: accountId } } },
    });

    return { status: true };
  }

  async setPersonalAccess(id: string, kind: PersonalAccessKind, targetId: string, allow: boolean) {
    const exists = await this.prisma.user.count({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`Користувач з id ${id} не знайдений`);
    }

    try {
      await this.prisma.user.update({
        where: { id },
        data: {
          [PERSONAL_ACCESS_RELATION[kind]]: allow
            ? { connect: { id: targetId } }
            : { disconnect: { id: targetId } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Обʼєкт для надання доступу не знайдено');
      }
      throw error;
    }

    return { status: true };
  }

  async remove(id: string, currentUser: RequestUser) {
    await this.assertCanManageUser(id, currentUser);

    return await this.prisma.user.delete({
      where: { id },
    });
  }
  async searchUsers(dto: SearchUserDto, currentUser: RequestUser) {
    const { query, page = 1, limit = 10, role } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      AND: [
        // SuperAdmin - усі; Admin - учасники своєї групи; User - лише він сам.
        currentUser.role === Roles.SuperAdmin
          ? {}
          : currentUser.role === Roles.Admin
            ? { userGroupId: currentUser.managedGroup?.id ?? '00000000-0000-0000-0000-000000000000' }
            : { id: currentUser.id },
        query
          ? {
            OR: [
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
            ],
          }
          : {},
        role ? {
          role: role as Roles
        } : {}
      ],
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          session: true,
          managedGroup: true,
          userGroup: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data: users, meta: { total, page, lastPage: Math.ceil(total / limit) } };
  }
}