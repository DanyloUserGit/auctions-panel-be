import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Prisma, Roles, Session, SessionEventType } from '@prisma/client';
import { AccessService, type AccessUser } from '../access/access.service';
import { accountSelectFor } from '../auction-auth/auction-auth.select';
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
    private notificationService: NotificationService,
    private access: AccessService
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

  // Сесії акаунта видно лише тим, кому дозволено використовувати цей акаунт.
  async getSessions(auctionAuthId: string, requester: AccessUser) {
    await this.access.assertCanUseAccount(requester, auctionAuthId);

    return this.prisma.session.findMany({
      where: { auctionAuthId, isActive: true },
      orderBy: {
        isActive: 'desc',
      },
      include: {
        users: true,
        auction: true,
        account: { select: accountSelectFor(requester.role) },
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

    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      include: { managedGroup: { select: { id: true } } },
    });
    if (!admin) throw new ForbiddenException('Користувача не знайдено');

    // Admin може завершити лише сесію, до якої підключений він сам або учасник його групи.
    if (admin.role !== Roles.SuperAdmin) {
      const managedGroupId = admin.role === Roles.Admin ? admin.managedGroup?.id : undefined;
      const isOwnGroupSession = managedGroupId
        ? await this.prisma.session.count({
          where: {
            id: sessionId,
            users: { some: { OR: [{ id: adminId }, { userGroupId: managedGroupId }] } },
          },
        })
        : 0;

      if (!isOwnGroupSession) {
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

  // Перевірка перед будь-якою роботою з обліковими даними: акаунт належить цьому аукціону
  // і користувач (userId з автентифікованого сокета) може його використовувати - canUseAccount().
  private async assertUserCanUseAccount(userId: string, auctionId: string, auctionAuthId: string): Promise<AccessUser> {
    const auctionAuth = await this.prisma.auctionAuth.findUnique({
      where: { id: auctionAuthId },
      select: { auctionId: true },
    });

    if (!auctionAuth || auctionAuth.auctionId !== auctionId) {
      throw new ForbiddenException('Обраний акаунт не належить цьому аукціону');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new ForbiddenException('Користувача не знайдено');
    }

    if (!(await this.access.canUseAccount(user, auctionAuthId))) {
      throw new ForbiddenException('У вас немає доступу до цього акаунта аукціону');
    }

    return user;
  }

  // sessionLimit групи аукціонів: максимум одночасно активних сесій на всіх її аукціонах (0 - без ліміту).
  // Діє для всіх ролей - обмеження навантаження на сервер.
  // Викликається всередині транзакції, що вже тримає блокування рядка групи аукціонів.
  private async assertAuctionGroupSessionLimit(tx: Prisma.TransactionClient, auctionGroupId: string | null) {
    if (!auctionGroupId) return;

    const group = await tx.auctionGroup.findUnique({
      where: { id: auctionGroupId },
      select: { title: true, sessionLimit: true },
    });
    if (!group || group.sessionLimit <= 0) return;

    const activeSessions = await tx.session.count({
      where: { isActive: true, auction: { auctionGroupId } },
    });

    if (activeSessions >= group.sessionLimit) {
      throw new BadRequestException(
        `Досягнуто ліміт одночасних сесій для групи аукціонів «${group.title}» (${group.sessionLimit})`
      );
    }
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
    // ДОДАНО: перевірка прав ПЕРЕД будь-якою роботою з реальними даними авторизації.
    const accessUser = await this.assertUserCanUseAccount(userId, auctionId, auctionAuthId);
    const canStartNew = await this.access.canStartNewSession(accessUser);

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

    const allowedRoutesArr = auction.allowedRoutes.map(route => route.path);
    const forbiddenRoutesArr = auction.forbiddenRoutes.map(route => route.path);
    const forbiddenSelectorsArr = auction.forbiddenSelectors.map(sel => sel.selector);

    let session: Session | null = null;
    if (sessionId) {
      session = await this.prisma.session.findUnique({ where: { id: sessionId } });
      // Повторне підключення - лише до сесії того самого аукціону й акаунта, права на який щойно перевірено.
      if (session && (session.auctionId !== auctionId || session.auctionAuthId !== auctionAuthId)) {
        throw new ForbiddenException('Сесія не належить обраному акаунту');
      }
      const existingTimeout = this.pendingClosures.get(sessionId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.pendingClosures.delete(sessionId);
        console.log(`[SessionsService] Таймер закриття сесії ${sessionId} скасовано (користувач повернувся)`);
      }
    }
    if (!session) {
      session = await this.prisma.session.findFirst({
        where: { auctionId, auctionAuthId, isActive: true },
      });
    }

    // Перевірка ліміту й запис сесії виконуються в одній транзакції з блокуванням рядків
    // (SELECT ... FOR UPDATE): спершу групи аукціонів, потім акаунта - завжди в цьому порядку.
    // Одночасні старти в межах групи/акаунта виконуються по черзі, тому ліміт не перевищується
    // і для одного акаунта не створюються дві паралельні сесії.
    const auctionGroupId = auction.auctionGroupId;
    const result = await this.prisma.$transaction(
      async (tx) => {
        let current = session;

        if (!current || !current.isActive) {
          if (auctionGroupId) {
            await tx.$queryRaw`SELECT id FROM "auction_groups" WHERE id = ${auctionGroupId}::uuid FOR UPDATE`;
          }
          await tx.$queryRaw`SELECT id FROM "auction_auths" WHERE id = ${auctionAuthId}::uuid FOR UPDATE`;

          // Поки чекали на блокування, сесію цього акаунта міг запустити інший запит - приєднуємось до неї.
          const running = await tx.session.findFirst({
            where: { auctionId, auctionAuthId, isActive: true },
          });
          if (running) {
            current = running;
          } else {
            // Групі з вимкненим showAccounts дозволено лише приєднуватися до запущених сесій.
            if (!canStartNew) {
              throw new ForbiddenException('Запуск нових сесій для вашої групи вимкнено - можна приєднатися до вже запущеної сесії');
            }
            // Новий браузер (нова сесія або повторна активація неактивної) - лише в межах ліміту.
            // Приєднання до вже активної сесії цього ж акаунта лімітом не обмежується.
            await this.assertAuctionGroupSessionLimit(tx, auctionGroupId);
          }
        }

        if (current) {
          if (current.activeConnections >= current.maxConnections) {
            throw new BadRequestException('Досягнуто ліміт підключень до цього аукціону');
          }

          const wasInactive = !current.isActive;
          const updated = await tx.session.update({
            where: { id: current.id },
            data: {
              activeConnections: { increment: isReconnect ? 0 : 1 },
              isActive: true,
              users: { connect: { id: userId } },
              auctionGroup: auctionGroupId ? { connect: { id: auctionGroupId } } : { disconnect: true },
            },
          });
          return { session: updated, startsBrowser: wasInactive, isNew: false };
        }

        const created = await tx.session.create({
          data: {
            auction: { connect: { id: auctionId } },
            account: { connect: { id: authData.id } },
            users: { connect: { id: userId } },
            ...(auctionGroupId && { auctionGroup: { connect: { id: auctionGroupId } } }),
            maxConnections: 5,
            activeConnections: 1,
            isActive: true,
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 2),
          },
        });
        return { session: created, startsBrowser: true, isNew: true };
      },
      { maxWait: 10000, timeout: 15000 }
    );

    session = result.session;

    if (this.pendingClosures.has(session.id)) {
      clearTimeout(this.pendingClosures.get(session.id));
      this.pendingClosures.delete(session.id);
      console.log(`[SessionsService] Скасовано зупинку сесії ${session.id} (швидкий реконект)`);
    }

    if (result.isNew) {
      const user = await this.prisma.user.findFirst({ where: { id: userId } });
      const sessionLog = await this.prisma.session.findFirst({ where: { id: session.id }, select: { auction: true, account: true } });
      if (user) {
        this.notificationService.notify(userId, "SESSION_STARTED", {
          subject: "Новий вхід до системи",
          body: `Користувач ${user.firstName} ${user.lastName} запустив сесію для аукціону ${sessionLog?.auction.title} з акаунтом ${sessionLog?.account.title}.`
        }, false)
      }
    }

    if (result.startsBrowser) {
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

  async leaveSession(sessionId: string, userId?: string, immediate = false) {
    try {
      const currentSession = await this.prisma.session.findUnique({ where: { id: sessionId } });
      if (!currentSession || currentSession.activeConnections <= 0) return;

      const updatedSession = await this.prisma.session.update({
        where: { id: sessionId },
        data: { activeConnections: { decrement: 1 } },
      });

      // Якщо на цю сесію вже було заплановано закриття - прибираємо старий таймер
      // в будь-якому разі, щоб уникнути дубльованих/осиротілих setTimeout.
      if (this.pendingClosures.has(sessionId)) {
        clearTimeout(this.pendingClosures.get(sessionId));
        this.pendingClosures.delete(sessionId);
      }

      if (updatedSession.activeConnections > 0) return;

      if (immediate) {
        await this.finalizeSessionClosure(sessionId);
        return;
      }

      console.log(`[SessionsService] Всі вийшли з ${sessionId}. Очікуємо 5 сек перед зупинкою...`);
      const timeout = setTimeout(async () => {
        try {
          const checkSession = await this.prisma.session.findUnique({ where: { id: sessionId } });
          if (checkSession && checkSession.activeConnections === 0) {
            await this.finalizeSessionClosure(sessionId);
          }
          this.pendingClosures.delete(sessionId);
        } catch (e) {
          console.error('Помилка під час відкладеного закриття сесії:', e);
        }
      }, 60000);

      this.pendingClosures.set(sessionId, timeout);
    } catch (error) {
      console.error(`[SessionsService] Помилка у leaveSession:`, error);
    }
  }

  // НОВЕ: винесена логіка фактичного закриття сесії, спільна для
  // явного виходу (immediate) і для grace-таймера.
  private async finalizeSessionClosure(sessionId: string) {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { isActive: false, endedAt: new Date() },
    });

    await this.loggerService.logEvent({
      sessionId,
      eventType: SessionEventType.Other,
      severity: 'Info',
      message: 'Сесія завершена (явний вихід або відсутність підключень)',
    });

    this.rabbitClient
      .emit('stop_browser_session', { sessionId })
      .subscribe({
        next: () => console.log(`[SessionsService] Команду зупинки відправлено в чергу`),
        error: (err) => console.error('Помилка відправки stop_browser_session:', err),
      });

    console.log(`[SessionsService] Сесія ${sessionId} остаточно зупинена!`);
  }
}