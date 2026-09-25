import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import * as crypto from 'crypto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from '../utils/password';
import type { LoginDto } from './dto/LoginDto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) { }

  async verifyTurnstileToken(token: string) {
    const response = await axios.post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
      },
    );
    if (!response.data.success) {
      throw new ForbiddenException('Капча не пройдена або застаріла');
    }
  }

  // Однакова відповідь для невідомого email і неправильного пароля: не видаємо, які email зареєстровані.
  private static readonly INVALID_CREDENTIALS = 'Невірний email або пароль';

  async login(user: LoginDto, ip?: string) {
    await this.verifyTurnstileToken(user.token);

    const existing = await this.prisma.user.findUnique({
      where: { email: user.email },
      omit: { password: false },
    });

    const fail = async (reason: string, message: string, targetUserId?: string) => {
      await this.auditLog.auth({
        action: 'login.failed',
        targetUserId,
        message: `Невдалий вхід (${user.email}): ${reason}`,
        details: { email: user.email, reason },
        ip,
      });
      return new ForbiddenException(message);
    };

    if (!existing) {
      throw await fail('користувача не знайдено', AuthService.INVALID_CREDENTIALS);
    }
    if (!(await verifyPassword(existing.password, user.password))) {
      throw await fail('неправильний пароль', AuthService.INVALID_CREDENTIALS, existing.id);
    }
    if (existing.isBlocked) {
      throw await fail('користувача заблоковано', 'Користувача заблоковано', existing.id);
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

    const now = new Date();
    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: existing.id,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await this.prisma.user.update({ where: { id: existing.id }, data: { lastLogin: now, lastActivity: now } });
    await this.auditLog.auth({
      action: 'login.success',
      actor: existing,
      targetUserId: existing.id,
      message: `Вхід: ${existing.firstName} ${existing.lastName} (${existing.email})`,
      ip,
    });

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

    if (tokenRecord.user.isBlocked) {
      throw new UnauthorizedException('Користувача заблоковано');
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
  async logout(refreshToken: string, ip?: string) {
    if (!refreshToken) return;

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (tokenRecord) {
      await this.auditLog.auth({
        action: 'logout',
        actor: tokenRecord.user,
        targetUserId: tokenRecord.user.id,
        message: `Вихід: ${tokenRecord.user.firstName} ${tokenRecord.user.lastName} (${tokenRecord.user.email})`,
        ip,
      });
    }
    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }
}
