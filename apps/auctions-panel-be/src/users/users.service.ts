import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Roles, User } from '@prisma/client';
import { accountSelectFor } from '../auction-auth/auction-auth.select';
import { AuditLogService } from '../audit-log/audit-log.service';
import { GlobalSettingsService } from '../global-settings/global-settings.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../utils/password';
import { ADMIN_FIELDS, CreateUserDto } from './dto/create-user.dto';
import { SearchUserDto } from './dto/search-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ACCESS_STATUS_LABEL } from './access-status';

// req.user, який повертає JwtStrategy (findOne), містить managedGroup.
type RequestUser = Pick<User, 'id' | 'role'> & { managedGroup?: { id: string } | null };

type TargetUser = Pick<User, 'id' | 'role' | 'email' | 'sessionLimit' | 'userGroupId'> & {
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

// Остання сесія користувача (ТЗ 4, 11): аукціон, час, статус.
const lastSessionInclude = {
  sessionConnections: {
    orderBy: { connectedAt: 'desc' },
    take: 1,
    select: {
      connectedAt: true,
      disconnectedAt: true,
      session: {
        select: { id: true, isActive: true, endReason: true, createdAt: true, endedAt: true, auction: { select: { title: true } } },
      },
    },
  },
} satisfies Prisma.UserInclude;

type LastConnection = Prisma.UserGetPayload<{ include: typeof lastSessionInclude }>['sessionConnections'][number];

export const sessionStatus = (session: { isActive: boolean; endReason: string | null }) =>
  session.isActive ? 'active' : session.endReason === 'Error' ? 'error' : 'ended';

const toLastSession = (connection?: LastConnection) =>
  connection
    ? {
      id: connection.session.id,
      auction: connection.session.auction.title,
      startedAt: connection.connectedAt,
      endedAt: connection.disconnectedAt ?? connection.session.endedAt,
      status: sessionStatus(connection.session),
    }
    : null;

// Прибирає службове поле sessionConnections і додає lastSession.
const withLastSession = <T extends { sessionConnections: LastConnection[] }>({ sessionConnections, ...user }: T) => ({
  ...user,
  lastSession: toLastSession(sessionConnections[0]),
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
  constructor(
    private prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly auditLog: AuditLogService,
    private readonly settings: GlobalSettingsService,
  ) { }

  private label(user: Pick<User, 'firstName' | 'lastName' | 'email'>) {
    return `${user.firstName} ${user.lastName} (${user.email})`;
  }

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

    // Власний ліміт сесій і адмін-поля картки (договір, депозит, коментар) змінює лише адміністратор.
    if (!isManagedMember && dto.sessionLimit !== undefined && dto.sessionLimit !== target.sessionLimit) {
      throw new ForbiddenException('Недостатньо прав для зміни ліміту сесій');
    }
    if (!isManagedMember && ADMIN_FIELDS.some((field) => dto[field] !== undefined)) {
      throw new ForbiddenException('Адміністративні поля картки змінює лише адміністратор');
    }
  }

  async create(createUserDto: CreateUserDto, currentUser: RequestUser) {
    let targetGroupId: string | undefined | null = createUserDto.userGroupId;

    if (currentUser.role !== Roles.SuperAdmin) {
      if (currentUser.role !== Roles.Admin) {
        throw new ForbiddenException('Недостатньо прав для створення користувачів');
      }
      // Інших GA своєї групи GA призначає лише з дозволу Super Admin (глобальне налаштування).
      const { gaCanAssignGa } = await this.settings.getSettings();
      const allowedRoles: Roles[] = gaCanAssignGa ? [Roles.User, Roles.Admin] : [Roles.User];
      if (!allowedRoles.includes(createUserDto.role as Roles)) {
        throw new ForbiddenException(
          gaCanAssignGa
            ? 'Адміністратор групи може створювати лише користувачів і адміністраторів своєї групи'
            : 'Адміністратор групи може створювати лише користувачів з роллю User',
        );
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
    const { statusReason, managedGroup: _managedGroup, ...data } = createUserDto;

    const user = await this.prisma.user.create({
      data: {
        ...data,
        password: hashedPassword,
        userGroupId: targetGroupId || null,
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
    if (user.userGroupId) {
      await this.notificationService.notifyGroupAdminAboutNewMember(user.userGroupId, [user.id]);
    }

    await this.auditLog.admin({
      action: 'user.create',
      actor: currentUser,
      targetUserId: user.id,
      message: `Створено користувача ${this.label(user)} з роллю ${user.role} і статусом «${ACCESS_STATUS_LABEL[user.accessStatus]}»${statusReason ? `. Причина статусу: ${statusReason}` : ''}`,
      details: { role: user.role, accessStatus: user.accessStatus, userGroupId: user.userGroupId, managedGroup: createUserDto.managedGroup, statusReason },
    });
    return user;
  }

  // Картка контролю користувача (ТЗ 11). Адмін-поля - лише для SuperAdmin і GA цього користувача.
  async getUserControlCard(id: string, currentUser: RequestUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        userGroup: { select: { id: true, name: true, sessionLimit: true } },
        managedGroup: { select: { id: true, name: true, sessionLimit: true } },
        ...lastSessionInclude,
      },
    });

    if (!user) {
      throw new NotFoundException(`Користувач не знайдений`);
    }

    const isSelf = currentUser.id === user.id;
    const isAdminView = currentUser.role === Roles.SuperAdmin || this.isManagedMember(currentUser, user);
    if (!isSelf && !isAdminView) {
      throw new ForbiddenException('У вас немає доступу до цього користувача');
    }

    const settings = await this.prisma.systemSetting.findUnique({ where: { key: 'GLOBAL_SESSION_LIMIT' } });
    const group = user.managedGroup ?? user.userGroup;

    return {
      profile: {
        id: user.id,
        firstName: user.firstName,
        middleName: user.middleName,
        lastName: user.lastName,
        fullName: [user.firstName, user.middleName, user.lastName].filter(Boolean).join(' '),
        email: user.email,
        phone: user.phone,
        city: user.city,
        role: user.role,
        userGroup: user.userGroup || null,
        managedGroup: user.managedGroup || null,
      },
      admin: isAdminView
        ? {
          hasContract: user.hasContract,
          contractNumber: user.contractNumber,
          depositAmount: user.depositAmount === null ? null : Number(user.depositAmount),
          depositMethod: user.depositMethod,
          adminComment: user.adminComment,
          adminExtra: user.adminExtra,
        }
        : null,
      status: {
        isActive: user.isActive,
        isBlocked: user.isBlocked,
        accessStatus: user.accessStatus,
      },
      activity: {
        lastLogin: user.lastLogin,
        lastActivity: user.lastActivity,
        lastSession: toLastSession(user.sessionConnections[0]),
      },
      // Ліміти, що діють на користувача (0 - без ліміту на цьому рівні).
      limits: {
        sessionLimit: user.sessionLimit,
        groupSessionLimit: group?.sessionLimit ?? 0,
        globalSessionLimit: settings ? Number(settings.value) : 100,
      },
      // Останні 10 інцидентів користувача (заборонені дії, помилки сесій).
      recentIncidents: isAdminView
        ? await this.prisma.sessionLog.findMany({
          where: { userId: id, isIncident: true },
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            eventType: true,
            message: true,
            sessionId: true,
            session: { select: { auction: { select: { title: true } } } },
          },
        })
        : [],
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

  // Зміна статусу доступу / блокування (ТЗ 12): GA - для своєї групи, SA - для всіх; причина - у журнал.
  async updateUserStatus(id: string, statusData: UpdateUserStatusDto, currentUser: RequestUser) {
    await this.assertCanManageUser(id, currentUser);
    const { reason, ...data } = statusData;

    const before = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const updated = await this.prisma.user.update({ where: { id }, data });

    const changes: string[] = [];
    if (data.accessStatus !== undefined && data.accessStatus !== before.accessStatus) {
      changes.push(`статус «${ACCESS_STATUS_LABEL[before.accessStatus]}» → «${ACCESS_STATUS_LABEL[data.accessStatus]}»`);
    }
    if (data.isBlocked !== undefined && data.isBlocked !== before.isBlocked) {
      changes.push(data.isBlocked ? 'заблоковано' : 'розблоковано');
    }
    if (data.isActive !== undefined && data.isActive !== before.isActive) {
      changes.push(data.isActive ? 'активовано' : 'деактивовано');
    }

    await this.auditLog.admin({
      action: 'user.status',
      actor: currentUser,
      targetUserId: id,
      message: `Користувач ${this.label(updated)}: ${changes.join(', ') || 'без змін'}. Причина: ${reason}`,
      details: { before: { accessStatus: before.accessStatus, isBlocked: before.isBlocked, isActive: before.isActive }, after: data, reason },
    });
    return updated;
  }
  async findAll(user: any) {
    try {
      if (!user) throw new NotFoundException();

      if (user.role === Roles.User) throw new ForbiddenException();

      if (user.role === Roles.Admin) {
        // Admin без керованої групи не має учасників.
        if (!user.managedGroup?.id) return [];
        {
          const members = await this.prisma.user.findMany({
            where: {
              userGroupId: user.managedGroup.id
            },
            include: { userGroup: { select: { id: true, name: true } }, ...lastSessionInclude },
          });
          return members.map(withLastSession);
        }
      }
      if (user.role === Roles.SuperAdmin) {
        const users = await this.prisma.user.findMany({
          include: { managedGroup: true, userGroup: { select: { id: true, name: true } }, ...lastSessionInclude },
        });
        return users.map(withLastSession);
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
        middleName: true,
        lastName: true,
        role: true,
        accessStatus: true,
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
    // Співадміністратор (GA, призначений іншим GA) керує групою, до якої належить.
    if (user.role === Roles.Admin && !user.managedGroup && user.userGroup) {
      return { ...user, managedGroup: user.userGroup };
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

  async touchActivity(id: string) {
    const threshold = new Date(Date.now() - 60_000);
    await this.prisma.user.updateMany({
      where: { id, OR: [{ lastActivity: null }, { lastActivity: { lt: threshold } }] },
      data: { lastActivity: new Date() },
    });
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

    if (updatedUser.userGroupId && updatedUser.userGroupId !== user.userGroupId) {
      await this.notificationService.notifyGroupAdminAboutNewMember(updatedUser.userGroupId, [id]);
    }

    // Журнал: які поля змінено (без значення пароля).
    const changed = Object.keys(updateUserDto).filter(
      (key) => key === 'password' || key === 'managedGroup' || (user as Record<string, unknown>)[key] !== (updatedUser as Record<string, unknown>)[key],
    );
    if (changed.length) {
      await this.auditLog.admin({
        action: currentUser.id === id ? 'profile.update' : 'user.update',
        actor: currentUser,
        targetUserId: id,
        message: `Змінено дані користувача ${this.label(updatedUser)}: ${changed.map((k) => (k === 'password' ? 'пароль' : k)).join(', ')}`,
        details: Object.fromEntries(changed.filter((k) => k !== 'password').map((k) => [k, (updateUserDto as Record<string, unknown>)[k]])),
      });
    }

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

    await this.auditLog.admin({
      action: deny ? 'access.user.deny-account' : 'access.user.undeny-account',
      actor: currentUser,
      targetUserId: id,
      message: `${deny ? 'Заборонено' : 'Повернуто'} акаунт групи користувачу`,
      details: { accountId },
    });
    return { status: true };
  }

  async setPersonalAccess(id: string, kind: PersonalAccessKind, targetId: string, allow: boolean, currentUser?: RequestUser) {
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

    const kindLabel = { auctionGroup: 'групи аукціонів', auction: 'аукціону', account: 'акаунта' }[kind];
    await this.auditLog.admin({
      action: `access.user.${allow ? 'grant' : 'revoke'}`,
      actor: currentUser,
      targetUserId: id,
      message: `${allow ? 'Надано' : 'Відкликано'} особистий доступ до ${kindLabel}`,
      details: { kind, targetId },
    });
    return { status: true };
  }

  async remove(id: string, currentUser: RequestUser) {
    await this.assertCanManageUser(id, currentUser);

    const removed = await this.prisma.user.delete({
      where: { id },
    });
    await this.auditLog.admin({
      action: 'user.delete',
      actor: currentUser,
      message: `Видалено користувача ${this.label(removed)}`,
      details: { userId: id, role: removed.role },
    });
    return removed;
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
          ...lastSessionInclude,
          managedGroup: true,
          userGroup: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data: users.map(withLastSession), meta: { total, page, lastPage: Math.ceil(total / limit) } };
  }
}