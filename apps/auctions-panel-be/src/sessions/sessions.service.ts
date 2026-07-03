import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Roles, Session, SessionEventType } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionLoggerService } from '../session-logger/session-logger.service';
import { decryptData } from '../utils/encrypt';

@Injectable()
export class SessionsService implements OnModuleInit {
  private pendingClosures = new Map<string, NodeJS.Timeout>();
  constructor(
    private prisma: PrismaService,
    @Inject('WORKER_SERVICE') private rabbitClient: ClientProxy,
    private loggerService: SessionLoggerService,
    private notificationService: NotificationService
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
      where: { auctionAuthId, isActive: true },
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

  async terminateExpiredSessions() {
    try {
      const expiredSessions = await this.prisma.session.findMany({
        where: { expiresAt: { lt: new Date() }, isActive: true },
        include: {
          auction: true,
          account: true,
          users: true,
        },
      });

      if (expiredSessions.length === 0) return;
      await this.prisma.session.updateMany({
        where: { id: { in: expiredSessions.map(s => s.id) } },
        data: {
          isActive: false,
          activeConnections: 0,
          endedAt: new Date(),
        },
      });

      for (const session of expiredSessions) {
        await this.loggerService.logEvent({
          sessionId: session.id,
          eventType: SessionEventType.Other,
          severity: 'Info',
          message: 'Сесія була автоматично завершена по таймеру',
          isIncident: false,
        });

        if (session.users && session.users.length > 0) {
          const notifyPromises = session.users.map((user) =>
            this.notificationService.notify(
              user.id,
              "SESSION_ENDED",
              {
                subject: "Час сесії вичерпано",
                body: `Час сесії вичерпано. \nСесія для аукціону ${session.auction.title} (акаунт ${session.account.email}) була автоматично завершена.`
              },
              false
            )
          );
          await Promise.all(notifyPromises);
        }
      }
    } catch (error) {
      throw error;
    }
  }

  async terminateSession(sessionId: string, adminId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new BadRequestException('Сесію не знайдено');
    }

    if (!session.isActive) {
      throw new BadRequestException('Ця сесія вже завершена');
    }

    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin) throw new ForbiddenException('Користувача не знайдено');

    if (admin.role !== Roles.SuperAdmin) {
      if (admin.role !== Roles.Admin || session.auctionGroupId !== admin.auctionGroupId) {
        throw new ForbiddenException('У вас немає прав для завершення сесії іншої групи');
      }
    }

    const updatedSession = await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        isActive: false,
        activeConnections: 0,
        endedAt: new Date(),
        endedById: adminId
      },
    });

    await this.loggerService.logEvent({
      sessionId: session.id,
      userId: adminId,
      eventType: SessionEventType.Other,
      severity: 'Warning',
      message: 'Сесія була примусово завершена диспетчером',
      isIncident: true,
    });

    const user = await this.prisma.user.findFirst({ where: { id: adminId } });
    const sessionLog = await this.prisma.session.findFirst({ where: { id: sessionId }, select: { auction: true, account: true } });
    if (user) {
      this.notificationService.notify(adminId, "SESSION_ENDED", {
        subject: "Сесія примусово завершена",
        body: `Користувач ${user.firstName} ${user.lastName} примусово закінчив сесію для аукціону ${sessionLog?.auction.title} з акаунтом ${sessionLog?.account.title}.`
      }, false)
    }

    this.rabbitClient
      .emit('stop_browser_session', {
        sessionId: session.id,
      })
      .subscribe({
        next: () => console.log(`[SessionsService] Сигнал на закриття сесії ${session.id} відправлено у worker`),
        error: (err) => console.error('[SessionsService] RabbitMQ stop error:', err),
      });

    if (this.pendingClosures.has(sessionId)) {
      clearTimeout(this.pendingClosures.get(sessionId));
      this.pendingClosures.delete(sessionId);
    }

    return updatedSession;
  }
  async getActiveSessionsForUser(userId: string) {
    return this.prisma.session.findMany({
      where: {
        isActive: true,
        users: { some: { id: userId } },
      },
      select: {
        id: true,
        auctionId: true,
        auctionAuthId: true,
      },
    });
  }
  async initializeSession(
    isReconnect: boolean,
    userId: string,
    auctionId: string,
    auctionAuthId: string,
    width: number,
    height: number,
    sessionId?: string
  ) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId }, include: {
        allowedRoutes: true,
        forbiddenRoutes: true,
        forbiddenSelectors: true,
      }
    });
    const authData = await this.prisma.auctionAuth.findUnique({ where: { id: auctionAuthId } });

    if (!auction || !authData) {
      throw new BadRequestException('Не знайдено облікових даних для цього аукціону');
    }

    console.log(`[SessionsService] Знайдено заборонених роутів для ${auctionId}:`, auction?.forbiddenRoutes);

    const allowedRoutesArr = auction.allowedRoutes.map(route => route.path);
    const forbiddenRoutesArr = auction.forbiddenRoutes.map(route => route.path);
    const forbiddenSelectorsArr = auction.forbiddenSelectors.map(sel => sel.selector);

    console.log(`[SessionsService] Масив шляхів для відправки:`, forbiddenRoutesArr);

    let session: Session | null = null;
    if (sessionId) {
      session = await this.prisma.session.findUnique({ where: { id: sessionId } });
      const existingTimeout = this.pendingClosures.get(sessionId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.pendingClosures.delete(sessionId);
        console.log(`[SessionsService] Таймер закриття сесії ${sessionId} скасовано (користувач повернувся)`);
      }
    }
    if (!session) {
      session = await this.prisma.session.findFirst({
        // ВИПРАВЛЕНО: Додано auctionAuthId, щоб не мішати різні акаунти в одну сесію!
        where: { auctionId, auctionAuthId, isActive: true },
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
          activeConnections: { increment: isReconnect ? 0 : 1 },
          isActive: true,
          users: { connect: { id: userId } },
        },
      });

      // 3. Запускаємо Playwright ТІЛЬКИ якщо він був реально зупинений
      if (wasInactive) {
        this.startBrowserWorker(userId,
          session.id, auction.url, width, height, authData,
          allowedRoutesArr, forbiddenSelectorsArr, forbiddenRoutesArr
        );
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
      const user = await this.prisma.user.findFirst({ where: { id: userId } });
      const sessionLog = await this.prisma.session.findFirst({ where: { id: sessionId }, select: { auction: true, account: true } });
      if (user) {
        this.notificationService.notify(userId, "SESSION_STARTED", {
          subject: "Новий вхід до системи",
          body: `Користувач ${user.firstName} ${user.lastName} запустив сесію для аукціону ${sessionLog?.auction.title} з акаунтом ${sessionLog?.account.title}.`
        }, false)
      }
      this.startBrowserWorker(
        userId, session.id, auction.url, width, height, authData,
        allowedRoutesArr, forbiddenSelectorsArr, forbiddenRoutesArr
      );
    }

    return session;
  }

  private startBrowserWorker(userId: string, sessionId: string,
    auctionUrl: string,
    width: number,
    height: number,
    authData: any,
    allowedRoutes: string[],
    forbiddenSelectors: string[],
    forbiddenRoutes: string[]) {
    this.rabbitClient
      .emit('start_browser_session', {
        userId,
        sessionId,
        auctionUrl,
        width,
        height,
        authEmail: authData.email,
        authPassword: decryptData(authData.password),
        allowedRoutes,
        forbiddenSelectors,
        forbiddenRoutes
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
                data: { isActive: false, endedAt: new Date() },
              });

              await this.loggerService.logEvent({
                sessionId,
                eventType: SessionEventType.Other,
                severity: 'Info',
                message: 'Сесія завершена автоматично (немає активних підключень)',
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
        }, 60000);

        this.pendingClosures.set(sessionId, timeout);
      }
    } catch (error) {
      console.error(`[SessionsService] Помилка у leaveSession:`, error);
    }
  }
}
