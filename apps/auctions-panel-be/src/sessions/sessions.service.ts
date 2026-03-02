import { BadRequestException, ForbiddenException, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Roles, SessionRights } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptData } from '../utils/encrypt';

@Injectable()
export class SessionsService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    @Inject('WORKER_SERVICE') private rabbitClient: ClientProxy,
  ) { }

  async onModuleInit() {
    console.log('⏳ Примусове підключення до RabbitMQ з API...');
    try {
      await this.rabbitClient.connect();
      console.log('✅ API успішно підключився до RabbitMQ!');
    } catch (error) {
      console.error('❌ Помилка підключення API до RabbitMQ:', error);
    }
  }
  async getSessions(auctionAuthId: string) {
    return this.prisma.session.findMany({
      where: { auctionAuthId },
      orderBy: {
        isActive: 'desc',
      },
      include: {
        users: true,
        auction: true,
        account: true,
      },
    });
  }
  async finishSession(sessionId: string, userId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { auction: true, account: true }
    });

    if (!session) {
      throw new BadRequestException('Сесію не знайдено');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('Користувача не знайдено');

    const isAdmin = user.role === Roles.SuperAdmin || user.role === Roles.Admin;
    if (!isAdmin) {
      throw new ForbiddenException('Недостатньо прав для завершення сесії');
    }

    if (!session.isActive) {
      return session;
    }

    this.rabbitClient.emit('stop_browser_session', {
      sessionId: session.id,
    }).subscribe({
      next: () =>
        console.log(`Сесія ${session.id} завершена у worker`),
      error: err =>
        console.error('RabbitMQ stop error:', err),
    });

    await this.prisma.session.delete({
      where: { id: session.id },
    });
    return { deleted: true };
  }

  async initializeSession(userId: string, auctionId: string, auctionAuthId: string, width: number, height: number, existingSessionId?: string) {
    if (existingSessionId) {
      const session = await this.prisma.session.findUnique({
        where: { id: existingSessionId }
      });

      if (!session) {
        throw new BadRequestException('Сесію не знайдено або вона вже завершена');
      }

      if (session.activeConnections >= session.maxConnections) {
        throw new BadRequestException('Досягнуто ліміт підключень до цього аукціону');
      }

      // Збільшуємо кількість активних підключень і повертаємо сесію
      return await this.prisma.session.update({
        where: { id: session.id },
        data: { activeConnections: { increment: 1 } },
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('Користувача не знайдено');
    const isAdmin = user.role === Roles.SuperAdmin || user.role === Roles.Admin;
    const allowedRights = [SessionRights.Buy, SessionRights.Sell, SessionRights.Read, SessionRights.All];
    if (isAdmin && !allowedRights.includes(user.sessionRights)) {
      throw new ForbiddenException('У вас немає прав для участі в аукціонах');
    }

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
    console.log(auction, isAdmin)
    if (!auction || auction.auctionAuths.length === 0) {
      throw new BadRequestException('Аукціон не знайдено або відсутні дані для входу');
    }

    const authData = auctionAuthId
      ? auction.auctionAuths.find(a => a.id === auctionAuthId)
      : auction.auctionAuths[0];

    if (!authData) throw new ForbiddenException('Не знайдено облікових даних для цього аукціону');

    let session = await this.prisma.session.findFirst({
      where: { auctionId, isActive: true },
    });

    if (session) {
      if (session.activeConnections >= session.maxConnections) {
        throw new BadRequestException('Досягнуто ліміт підключень до цього аукціону');
      }
      session = await this.prisma.session.update({
        where: { id: session.id },
        data: { activeConnections: { increment: 1 } },
      });
    } else {
      session = await this.prisma.session.create({
        data: {
          auction: {
            connect: { id: auctionId }
          },
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

      this.rabbitClient.emit('start_browser_session', {
        sessionId: session.id,
        auctionUrl: auction.url,
        width,
        height,
        authEmail: authData.email,
        authPassword: decryptData(authData.password),
      }).subscribe({
        next: () => console.log(`✅ Завдання (сесія: ${session?.id}) успішно відправлено в RabbitMQ!`),
        error: (err) => console.error('❌ Помилка відправки завдання в RabbitMQ:', err)
      });
    }

    return session;
  }
}