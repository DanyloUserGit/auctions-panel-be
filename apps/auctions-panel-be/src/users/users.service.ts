import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Roles, User } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { SearchUserDto } from './dto/search-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { hashPassword } from '../utils/password';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  async create(createUserDto: CreateUserDto, currentUser?: User) {
    const hashedPassword = await hashPassword(createUserDto.password);

    let targetGroupId:string | undefined | null = createUserDto.auctionGroupId;

    if (currentUser) {
      if (currentUser.role !== Roles.SuperAdmin) {
        if (currentUser.auctionGroupId) {
          targetGroupId = currentUser.auctionGroupId;
        }
      }
    } else {
      targetGroupId = null;
    }

    return await this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
        auctionGroupId: targetGroupId || null,
      },
    });
  }

  async getUserControlCard(id: string, currentUser: User) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        auctionGroup: true,
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

    if (currentUser.role === 'Admin' && user.auctionGroupId !== currentUser.auctionGroupId) {
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
        group: user.auctionGroup?.title || 'Без групи',
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

  async updateUserStatus(id: string, statusData: { isBlocked?: boolean; isActive?: boolean }) {
    return await this.prisma.user.update({
      where: { id },
      data: statusData,
    });
  }
  async findAll() {
    return await this.prisma.user.findMany();
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
      },
    });
    if (!user) {
      throw new NotFoundException(`Користувач з id ${id} не знайдений`);
    }
    return user;
  }

  async findOneByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) {
      throw new NotFoundException(`Користувач з id ${email} не знайдений`);
    }
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`Користувач з id ${id} не знайдений`);
    }

    return await this.prisma.user.update({
      where: { id },
      data: updateUserDto,
    });
  }

  async remove(id: string) {
    const exists = await this.prisma.user.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`Користувач з id ${id} не знайдений`);
    }

    return await this.prisma.user.delete({
      where: { id },
    });
  }
  async searchUsers(dto: SearchUserDto, currentUser: User) {
    const { query, page = 1, limit = 10, role } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      AND: [
        currentUser.role !== 'SuperAdmin' ? { auctionGroupId: currentUser.auctionGroupId } : {},
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
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data: users, meta: { total, page, lastPage: Math.ceil(total / limit) } };
  }
}
