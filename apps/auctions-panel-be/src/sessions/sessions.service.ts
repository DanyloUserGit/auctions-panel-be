import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Roles, Session, SessionRights } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptData } from '../utils/encrypt';

@Injectable()
export class SessionsService implements OnModuleInit {
  private pendingClosures = new Map<string, NodeJS.Timeout>();
  constructor(
    private prisma: PrismaService,
    @Inject('WORKER_SERVICE') private rabbitClient: ClientProxy
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
      include: { auction: true, account: true },
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

    this.rabbitClient
      .emit('stop_browser_session', {
        sessionId: session.id,
      })
      .subscribe({
        next: () => console.log(`Сесія ${session.id} завершена у worker`),
        error: (err) => console.error('RabbitMQ stop error:', err),
      });

    await this.prisma.session.delete({
      where: { id: session.id },
    });
    return { deleted: true };
  }

  async initializeSession(
    userId: string,
    auctionId: string,
    auctionAuthId: string,
    width: number,
    height: number,
    sessionId?: string
  ) {
    const auction = await this.prisma.auction.findUnique({ where: { id: auctionId } });
    const authData = await this.prisma.auctionAuth.findUnique({ where: { id: auctionAuthId } });

    if (!auction || !authData) {
      throw new BadRequestException('Не знайдено облікових даних для цього аукціону');
    }

    let session: Session | null = null;
    if (sessionId) {
      session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    }
    if (!session) {
      session = await this.prisma.session.findFirst({
        where: { auctionId, isActive: true },
      });
    }

    if (session) {
      if (session.activeConnections >= session.maxConnections) {
        throw new BadRequestException('Досягнуто ліміт підключень до цього аукціону');
      }

      // 1. СКАСОВУЄМО ТАЙМЕР ЗАКРИТТЯ, ЯКЩО ВІН Є (користувач встиг оновити сторінку)
      if (this.pendingClosures.has(session.id)) {
        clearTimeout(this.pendingClosures.get(session.id));
        this.pendingClosures.delete(session.id);
        console.log(`[SessionsService] Скасовано зупинку сесії ${session.id} (швидкий реконект)`);
      }

      // 2. Тепер сесія вважається "мертвою", ТІЛЬКИ якщо isActive === false
      const wasInactive = !session.isActive;

      // Атомарно збільшуємо кількість підключень
      session = await this.prisma.session.update({
        where: { id: session.id },
        data: {
          activeConnections: { increment: 1 },
          isActive: true
        },
      });

      // 3. Запускаємо Playwright ТІЛЬКИ якщо він був реально зупинений
      if (wasInactive) {
        this.startBrowserWorker(session.id, auction.url, width, height, authData);
      }

    } else {
      session = await this.prisma.session.create({
        data: {
          auction: { connect: { id: auctionId } },
          account: { connect: { id: authData.id } },
          users: { connect: { id: userId } },
          maxConnections: 5,
          activeConnections: 1,
          isActive: true,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 2),
        },
      });

      this.startBrowserWorker(session.id, auction.url, width, height, authData);
    }

    return session;
  }

  private startBrowserWorker(sessionId: string, auctionUrl: string, width: number, height: number, authData: any) {
    this.rabbitClient
      .emit('start_browser_session', {
        sessionId,
        auctionUrl,
        width,
        height,
        authEmail: authData.email,
        authPassword: decryptData(authData.password),
      })
      .subscribe({
        next: () => console.log(`✅ Завдання (сесія: ${sessionId}) успішно відправлено в RabbitMQ!`),
        error: (err) => console.error(`❌ Помилка відправки в RabbitMQ для сесії ${sessionId}:`, err),
      });
  }
  async leaveSession(sessionId: string) {
    try {
      const currentSession = await this.prisma.session.findUnique({ where: { id: sessionId } });

      // ВАЖЛИВИЙ ЗАХИСТ: Не зменшуємо лічильник, якщо сесії немає або підключень вже 0.
      // (Без цього Prisma падала з помилкою і ламала таймер!)
      if (!currentSession || currentSession.activeConnections <= 0) return;

      // Атомарне зменшення
      const updatedSession = await this.prisma.session.update({
        where: { id: sessionId },
        data: { activeConnections: { decrement: 1 } },
      });

      if (updatedSession.activeConnections === 0) {
        console.log(`[SessionsService] Всі вийшли з ${sessionId}. Очікуємо 5 сек перед зупинкою...`);

        const timeout = setTimeout(async () => {
          try {
            const checkSession = await this.prisma.session.findUnique({ where: { id: sessionId } });

            // Якщо за 5 секунд ніхто не зайшов -> вбиваємо сесію
            if (checkSession && checkSession.activeConnections === 0) {
              await this.prisma.session.update({
                where: { id: sessionId },
                data: { isActive: false },
              });

              // ДОДАНО .subscribe() - тепер команда реально дійде до Worker-а!
              this.rabbitClient
                .emit('stop_browser_session', { sessionId })
                .subscribe({
                  next: () => console.log(`[SessionsService] Команду зупинки відправлено в чергу`),
                  error: (err) => console.error('Помилка відправки stop_browser_session:', err)
                });

              console.log(`[SessionsService] Сесія ${sessionId} остаточно зупинена!`);
            }

            this.pendingClosures.delete(sessionId);
          } catch (e) {
            console.error('Помилка під час відкладеного закриття сесії:', e);
          }
        }, 5000);

        this.pendingClosures.set(sessionId, timeout);
      }
    } catch (error) {
      console.error(`[SessionsService] Помилка у leaveSession:`, error);
    }
  }
}
