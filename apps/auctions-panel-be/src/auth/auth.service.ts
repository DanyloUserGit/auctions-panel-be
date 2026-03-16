import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as crypto from 'crypto';
import type { LoginDto } from './dto/LoginDto';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from '../utils/password';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private notificationService: NotificationService
  ) { }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findOneByEmail(email);

    if (!user) throw new BadRequestException('Користувача не знайдено');

    const isMatch = await verifyPassword(password, user.password);
    if (!isMatch) throw new BadRequestException('Паролі не співпадають');

    return user;
  }

  async login(user: LoginDto) {
    const existing = await this.usersService.findOneByEmail(user.email);

    if (!existing) {
      throw new NotFoundException('Користувача не знайдено');
    }

    const isValidPass = await verifyPassword(existing.password, user.password);
    if (!isValidPass) {
      throw new ForbiddenException('Паролі не співпадають');
    }

    const payload = {
      id: existing.id,
      email: existing.email,
      firstName: existing.firstName,
      lastName: existing.lastName,
      role: existing.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = crypto.randomBytes(64).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: existing.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    this.notificationService.notify(payload.id, "USER_LOGED_IN", {
      subject: "Новий вхід до системи",
      body: `Користувач ${payload.firstName} ${payload.lastName} увійшов в систему.`
    }, false)

    return { accessToken, refreshToken };
  }

  async refresh(oldRefreshToken: string) {
    if (!oldRefreshToken) {
      throw new UnauthorizedException('Неправильний попередній refresh token');
    }
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: oldRefreshToken },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Неправильний refresh token');
    }

    await this.prisma.refreshToken.delete({
      where: { token: oldRefreshToken },
    });

    const payload = { id: tokenRecord.user.id, email: tokenRecord.user.email };

    const newAccessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const newRefreshToken = crypto.randomBytes(64).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: tokenRecord.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }
  async logout(refreshToken: string) {
    if (!refreshToken) return;

    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }
}
