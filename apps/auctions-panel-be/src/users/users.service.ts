import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { SearchUserDto } from './dto/search-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { hashPassword } from '../utils/password';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const hashedPassword = await hashPassword(createUserDto.password);
    return await this.prisma.user.create({ data: { ...createUserDto, password: hashedPassword } });
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
  async searchUsers(dto: SearchUserDto) {
    const { query, page = 1, limit = 10 } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = query
      ? {
          OR: [
            {
              firstName: {
                contains: query,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              lastName: {
                contains: query,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              email: {
                contains: query,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          rights: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }
}
