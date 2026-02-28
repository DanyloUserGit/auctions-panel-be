// apps/cloud-browser/src/session/session.service.ts
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Roles, SessionRights } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptData } from '../utils/encrypt';

@Injectable()
export class SessionsService  {
  constructor(
    private prisma: PrismaService,
    @Inject('WORKER_SERVICE') private rabbitClient: ClientProxy, // Наш RabbitMQ клієнт з Кроку 1
  ) { }

  async initializeSession(userId: string, auctionId: string, width:number, height:number) {
    // 1. Отримуємо користувача та перевіряємо права
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('Користувача не знайдено');
    const isAdmin = user.role === Roles.Admin;
    // Перевірка прав (наприклад, дозволяємо лише тим, у кого є права Buy, Sell або All)
    const allowedRights = [SessionRights.Buy, SessionRights.Sell, SessionRights.Read, SessionRights.All];
    if (isAdmin && !allowedRights.includes(user.sessionRights)) {
      throw new ForbiddenException('У вас немає прав для участі в аукціонах');
    }

    // 2. Отримуємо аукціон та облікові дані (AuctionAuth)
    const auction = await this.prisma.auction.findFirst({
      where: {
        AND: [{ id: auctionId }, !isAdmin
          ? {
            users: {
              some: { id: user?.id },
            },
          }
          : {},]
      },
      include: { auctionAuths: true },
    });
    if (!auction || auction.auctionAuths.length === 0) {
      throw new BadRequestException('Аукціон не знайдено або відсутні дані для входу');
    }

    // Беремо перший доступний акаунт для цього аукціону
    const authData = auction.auctionAuths[0];

    // 3. Перевірка або створення сесії
    // Шукаємо існуючу активну сесію для цього аукціону
    let session = await this.prisma.session.findFirst({
      where: { auctionId, isActive: true },
    });

    if (session) {
      // Якщо сесія є, перевіряємо ліміти
      if (session.activeConnections >= session.maxConnections) {
        throw new BadRequestException('Досягнуто ліміт підключень до цього аукціону');
      }
      // Збільшуємо лічильник підключень
      session = await this.prisma.session.update({
        where: { id: session.id },
        data: { activeConnections: { increment: 1 } },
      });
    } else {
      // Створюємо нову сесію
      session = await this.prisma.session.create({
        data: {
          auction: {
            connect: { id: auctionId }
          },
          // Замість auctionAuthId: authData.id пишемо так:
          account: {
            connect: { id: authData.id }
          },
          users: {
            connect: { id: userId }
          },
          maxConnections: 5,
          activeConnections: 1,
          isActive: true,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 2),
        },
      });

      // ВІДПРАВЛЯЄМО ЗАВДАННЯ ВОРКЕРУ НА ЗАПУСК БРАУЗЕРА
      this.rabbitClient.emit('start_browser_session', {
        sessionId: session.id,
        auctionUrl: auction.url,
        width,
        height,
        authEmail: authData.email,
        authPassword: decryptData(authData.password), // У продакшені це варто дешифрувати перед відправкою
      }).subscribe({
        next: () => console.log('✅ Завдання успішно відправлено в RabbitMQ'),
        error: (err) => console.error('❌ Помилка відправки в RabbitMQ:', err),
      }); ;
    }

    return session;
  }
}