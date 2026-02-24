import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import { verifyPassword } from 'src/utils/password';
import type { LoginDto } from './dto/LoginDto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService
  ) {}

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findOneByEmail(email);

    if (!user) throw new BadRequestException('Користувача не знайдено');

    const isMatch = await verifyPassword(password, user.password);
    if (!isMatch) throw new BadRequestException('Паролі не співпадають');

    return user;
  }

  async login(user: LoginDto) {
    const payload = { email: user.email };

    const existing = await this.usersService.findOneByEmail(user.email);

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

    return { accessToken, refreshToken };
  }

  async refresh(oldRefreshToken: string) {
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
