import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LogSeverity, Prisma, Roles, SessionEndReason, SessionEventType } from '@prisma/client';
import { AccessService, type AccessUser } from '../access/access.service';
import { GlobalSettingsService } from '../global-settings/global-settings.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { managedGroupIdOf } from '../users/managed-group';
import { SessionLoggerService } from '../session-logger/session-logger.service';
import { decryptData } from '../utils/encrypt';
import { SessionRoomNotifier } from './session-room.notifier';

// Скільки чекаємо після від'єднання останнього користувача, перш ніж закрити браузер
// (оновлення сторінки, короткий обрив мережі).
const EMPTY_SESSION_GRACE_MS = 60_000;

const END_REASON_TEXT: Record<SessionEndReason, string> = {
  Admin: 'Сесію завершив адміністратор',
  Inactivity: 'Сесію завершено через бездіяльність',
  NoConnections: 'Сесію завершено: від’єдналися всі користувачі',
  Error: 'Сесію завершено через помилку',
};

export type ConnectParams = {
  userId: string;
  clientId: string;
  auctionId: string;
  auctionAuthId: string;
  width: number;
  height: number;
  // Сесія, яку клієнт уже мав (відновлення вкладки після оновлення сторінки).
  preferredSessionId?: string;
};

// Проксі для Playwright: сервер окремо від логіна й пароля.
function toProxySettings(url: string) {
  const parsed = new URL(url);
  return {
    server: `${parsed.protocol}//${parsed.host}`,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  };
}

@Injectable()
export class SessionsService implements OnModuleInit {
  private readonly logger = new Logger(SessionsService.name);
  private pendingClosures = new Map<string, NodeJS.Timeout>();

  constructor(
    private prisma: PrismaService,
    @Inject('WORKER_SERVICE') private rabbitClient: ClientProxy,
    private loggerService: SessionLoggerService,
    private notificationService: NotificationService,
    private access: AccessService,
    private settings: GlobalSettingsService,
    private rooms: SessionRoomNotifier,
  ) { }

  async onModuleInit() {
    try {
      await this.rabbitClient.connect();
    } catch (error) {
      this.logger.error('Помилка підключення API до RabbitMQ', error as Error);
    }
    // Після перезапуску API вкладки перепідключаються самі. Сесії, до яких ніхто не повернувся, закриваються.
    setTimeout(() => this.reconcileConnections().catch((e) => this.logger.error(e)), EMPTY_SESSION_GRACE_MS + 30_000).unref();
  }

  // ---------- Запити ----------

  // Активні сесії акаунта - лише тим, кому дозволено використовувати акаунт. Без даних інших користувачів.
  async getSessions(auctionAuthId: string, requester: AccessUser) {
    await this.access.assertCanUseAccount(requester, auctionAuthId);

    return this.prisma.session.findMany({
      where: { auctionAuthId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        isActive: true,
        auctionId: true,
        auctionAuthId: true,
        maxConnections: true,
        activeConnections: true,
        createdAt: true,
      },
    });
  }

  // Вкладки користувача для відновлення після оновлення сторінки: усі сесії з його відкритими підключеннями.
  async getActiveSessionsForUser(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { isActive: true, connections: { some: { userId, disconnectedAt: null } } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        auctionId: true,
        auctionAuthId: true,
        auction: { select: { title: true } },
        account: { select: { title: true } },
        connections: { where: { userId, disconnectedAt: null }, select: { connectedAt: true }, take: 1 },
      },
    });
    return sessions.map(({ connections, auction, account, ...s }) => ({
      ...s,
      auctionTitle: auction.title,
      accountTitle: account.title,
      connectedAt: connections[0]?.connectedAt,
    }));
  }

  // ---------- Підключення ----------

  // Акаунт належить аукціону і користувач може його використовувати - перевірка до будь-якої роботи з обліковими даними.
  private async assertUserCanUseAccount(userId: string, auctionId: string, auctionAuthId: string) {
    const auctionAuth = await this.prisma.auctionAuth.findUnique({
      where: { id: auctionAuthId },
      select: { auctionId: true },
    });
    if (!auctionAuth || auctionAuth.auctionId !== auctionId) {
      throw new ForbiddenException('Обраний акаунт не належить цьому аукціону');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, sessionLimit: true, userGroupId: true, managedGroup: { select: { id: true } } },
    });
    if (!user) throw new ForbiddenException('Користувача не знайдено');

    if (!(await this.access.canUseAccount(user, auctionAuthId))) {
      throw new ForbiddenException('У вас немає доступу до цього акаунта аукціону');
    }
    return user;
  }

  private openConnectionsCount(tx: Prisma.TransactionClient, sessionId: string) {
    return tx.sessionConnection.count({ where: { sessionId, disconnectedAt: null } });
  }

  // Ліміти користувача та його групи рахують сесії, до яких вони підключені (вкладки), включно з приєднанням.
  private async assertUserAndGroupLimits(
    tx: Prisma.TransactionClient,
    user: { id: string; sessionLimit: number; userGroupId: string | null; managedGroup: { id: string } | null },
    targetSessionId?: string,
  ) {
    const exceptTarget = targetSessionId ? { id: { not: targetSessionId } } : {};

    if (user.sessionLimit > 0) {
      const own = await tx.session.count({
        where: { isActive: true, ...exceptTarget, connections: { some: { userId: user.id, disconnectedAt: null } } },
      });
      if (own >= user.sessionLimit) {
        throw new BadRequestException(`Досягнуто ваш ліміт одночасних сесій (${user.sessionLimit})`);
      }
    }

    const groupId = user.managedGroup?.id ?? user.userGroupId;
    if (!groupId) return;
    const group = await tx.userGroup.findUnique({ where: { id: groupId }, select: { name: true, sessionLimit: true, AdminId: true } });
    if (!group || group.sessionLimit <= 0) return;

    const members: Prisma.UserWhereInput = {
      OR: [{ userGroupId: groupId }, ...(group.AdminId ? [{ id: group.AdminId }] : [])],
    };
    const used = await tx.session.count({
      where: { isActive: true, ...exceptTarget, connections: { some: { disconnectedAt: null, user: members } } },
    });
    if (used >= group.sessionLimit) {
      throw new BadRequestException(`Досягнуто ліміт одночасних сесій групи «${group.name}» (${group.sessionLimit})`);
    }
  }

  // Ліміти запуску нового браузера: група аукціонів і система загалом (навантаження на сервер).
  private async assertNewBrowserLimits(tx: Prisma.TransactionClient, auctionGroupId: string | null, globalLimit: number) {
    if (auctionGroupId) {
      const group = await tx.auctionGroup.findUnique({ where: { id: auctionGroupId }, select: { title: true, sessionLimit: true } });
      if (group && group.sessionLimit > 0) {
        const active = await tx.session.count({ where: { isActive: true, auction: { auctionGroupId } } });
        if (active >= group.sessionLimit) {
          throw new BadRequestException(
            `Досягнуто ліміт одночасних сесій для групи аукціонів «${group.title}» (${group.sessionLimit})`,
          );
        }
      }
    }

    if (globalLimit > 0) {
      const active = await tx.session.count({ where: { isActive: true } });
      if (active >= globalLimit) {
        throw new BadRequestException(`Досягнуто загальний ліміт сесій системи (${globalLimit}). Спробуйте пізніше`);
      }
    }
  }

  // Автоматичне підключення (ТЗ 7.3): до активної сесії цього акаунта з вільним місцем, інакше - нова сесія.
  // Користувач сесію не обирає; preferredSessionId лише відновлює вкладку після оновлення сторінки.
  async connect(params: ConnectParams) {
    const { userId, clientId, auctionId, auctionAuthId, preferredSessionId } = params;
    const user = await this.assertUserCanUseAccount(userId, auctionId, auctionAuthId);
    const canStartNew = await this.access.canStartNewSession(user);
    const { sessionMaxConnections, globalSessionLimit, streamFps, streamQuality, streamBitrateKbps } = await this.settings.getSettings();

    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { id: true, url: true, auctionGroupId: true, proxyUrl: true },
    });
    const account = await this.prisma.auctionAuth.findUnique({ where: { id: auctionAuthId } });
    if (!auction || !account) throw new BadRequestException('Не знайдено облікових даних для цього аукціону');

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Блокування рядків (завжди в одному порядку: група аукціонів, потім акаунт): одночасні
        // підключення до одного акаунта виконуються по черзі - ліміти й місця в сесіях не перевищуються.
        if (auction.auctionGroupId) {
          await tx.$queryRaw`SELECT id FROM "auction_groups" WHERE id = ${auction.auctionGroupId}::uuid FOR UPDATE`;
        }
        await tx.$queryRaw`SELECT id FROM "auction_auths" WHERE id = ${auctionAuthId}::uuid FOR UPDATE`;

        const running = await tx.session.findMany({
          where: { auctionAuthId, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, maxConnections: true },
        });

        // 1. Користувач уже має вкладку в одній із сесій цього акаунта: забираємо її (після оновлення сторінки
        //    старий сокет уже закрито) або повертаємо ту саму, якщо це той самий сокет.
        const ownConnection = await tx.sessionConnection.findFirst({
          where: { userId, disconnectedAt: null, session: { auctionAuthId, isActive: true } },
          orderBy: { connectedAt: 'desc' },
        });
        if (ownConnection && (ownConnection.clientId === clientId || !this.rooms.isClientConnected(ownConnection.clientId))) {
          await tx.sessionConnection.update({ where: { id: ownConnection.id }, data: { clientId } });
          return { sessionId: ownConnection.sessionId, isNew: false, joined: false };
        }

        // 2. Сесія з вільним місцем: спершу та, яку клієнт мав раніше, потім найстаріша.
        const ordered = [
          ...running.filter((s) => s.id === preferredSessionId),
          ...running.filter((s) => s.id !== preferredSessionId),
        ];
        for (const candidate of ordered) {
          if ((await this.openConnectionsCount(tx, candidate.id)) >= candidate.maxConnections) continue;

          await this.assertUserAndGroupLimits(tx, user, candidate.id);
          await tx.sessionConnection.create({ data: { sessionId: candidate.id, userId, clientId } });
          await tx.session.update({
            where: { id: candidate.id },
            data: { activeConnections: await this.openConnectionsCount(tx, candidate.id) },
          });
          return { sessionId: candidate.id, isNew: false, joined: true };
        }

        // 3. Нова сесія (жодної активної або всі заповнені).
        if (!canStartNew) {
          throw new ForbiddenException(
            running.length
              ? 'Усі сесії цього акаунта заповнені, а запуск нових сесій для вашої групи вимкнено'
              : 'Запуск нових сесій для вашої групи вимкнено - можна приєднатися лише до вже запущеної сесії',
          );
        }
        await this.assertUserAndGroupLimits(tx, user);
        await this.assertNewBrowserLimits(tx, auction.auctionGroupId, globalSessionLimit);

        const created = await tx.session.create({
          data: {
            auction: { connect: { id: auctionId } },
            account: { connect: { id: auctionAuthId } },
            ...(auction.auctionGroupId && { auctionGroup: { connect: { id: auction.auctionGroupId } } }),
            maxConnections: sessionMaxConnections,
            activeConnections: 1,
            isActive: true,
            connections: { create: { userId, clientId } },
          },
        });
        return { sessionId: created.id, isNew: true, joined: true };
      },
      { maxWait: 10000, timeout: 15000 },
    );

    this.cancelPendingClosure(result.sessionId);

    if (result.isNew) {
      await this.loggerService.logEvent({
        sessionId: result.sessionId,
        userId,
        eventType: SessionEventType.Other,
        message: `Сесію запущено користувачем ${userId}`,
      });
      this.startBrowserWorker(result.sessionId, auction.url, params.width, params.height, account, {
        fps: streamFps,
        quality: streamQuality,
        bitrateKbps: streamBitrateKbps,
      }, auction.proxyUrl);
    } else if (result.joined) {
      await this.loggerService.logEvent({
        sessionId: result.sessionId,
        userId,
        eventType: SessionEventType.Other,
        message: `Користувач ${userId} підключився до сесії`,
      });
    }

    return this.prisma.session.findUniqueOrThrow({ where: { id: result.sessionId } });
  }

  private startBrowserWorker(
    sessionId: string,
    auctionUrl: string,
    width: number,
    height: number,
    account: { email: string; password: string },
    stream: { fps: number; quality: number; bitrateKbps: number },
    encryptedProxy: string | null,
  ) {
    const proxy = encryptedProxy ? toProxySettings(decryptData(encryptedProxy)) : undefined;
    this.rabbitClient
      .emit('start_browser_session', {
        sessionId,
        auctionUrl,
        width,
        height,
        authEmail: account.email,
        authPassword: decryptData(account.password),
        stream,
        proxy,
      })
      .subscribe({
        error: (err) => this.logger.error(`Помилка відправки start_browser_session для ${sessionId}`, err),
      });
  }

  // ---------- Від'єднання та завершення ----------

  private cancelPendingClosure(sessionId: string) {
    const timer = this.pendingClosures.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingClosures.delete(sessionId);
    }
  }

  // Закриває вкладку клієнта в сесії. Коли вкладок не лишилося - сесія завершується
  // одразу (явний вихід) або після паузи (обрив з'єднання, оновлення сторінки).
  async disconnectClient(sessionId: string, clientId: string, immediate: boolean) {
    const closed = await this.prisma.sessionConnection.updateManyAndReturn({
      where: { sessionId, clientId, disconnectedAt: null },
      data: { disconnectedAt: new Date() },
      select: { userId: true },
    });
    if (closed.length === 0) return;

    const open = await this.prisma.sessionConnection.count({ where: { sessionId, disconnectedAt: null } });
    await this.prisma.session.updateMany({ where: { id: sessionId, isActive: true }, data: { activeConnections: open } });

    for (const { userId } of closed) {
      await this.loggerService.logEvent({
        sessionId,
        userId,
        eventType: SessionEventType.Other,
        message: `Користувач ${userId} від'єднався від сесії`,
      });
    }

    if (open > 0) return;
    if (immediate) {
      await this.endSession(sessionId, SessionEndReason.NoConnections);
      return;
    }

    this.cancelPendingClosure(sessionId);
    const timer = setTimeout(() => {
      this.pendingClosures.delete(sessionId);
      this.prisma.sessionConnection
        .count({ where: { sessionId, disconnectedAt: null } })
        .then((stillOpen) => (stillOpen === 0 ? this.endSession(sessionId, SessionEndReason.NoConnections) : undefined))
        .catch((e) => this.logger.error(`Помилка відкладеного закриття сесії ${sessionId}`, e));
    }, EMPTY_SESSION_GRACE_MS);
    timer.unref();
    this.pendingClosures.set(sessionId, timer);
  }

  // Єдине місце завершення сесії: база, журнал, воркер, відкриті вкладки та сповіщення.
  async endSession(sessionId: string, reason: SessionEndReason, options: { endedById?: string; errorMessage?: string } = {}) {
    this.cancelPendingClosure(sessionId);

    const now = new Date();
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, isActive: true },
      data: {
        isActive: false,
        activeConnections: 0,
        endedAt: now,
        endReason: reason,
        endedById: options.endedById ?? null,
        errorMessage: options.errorMessage ?? null,
      },
    });
    if (count === 0) return false;

    const closed = await this.prisma.sessionConnection.updateManyAndReturn({
      where: { sessionId, disconnectedAt: null },
      data: { disconnectedAt: now },
      select: { userId: true },
    });

    const message = options.errorMessage ? `${END_REASON_TEXT[reason]}: ${options.errorMessage}` : END_REASON_TEXT[reason];
    await this.loggerService.logEvent({
      sessionId,
      userId: options.endedById,
      eventType: reason === SessionEndReason.Error ? SessionEventType.SessionError : SessionEventType.Other,
      severity: reason === SessionEndReason.Error ? LogSeverity.Critical : reason === SessionEndReason.Admin ? LogSeverity.Warning : LogSeverity.Info,
      message: options.endedById ? `${message} (${options.endedById})` : message,
      isIncident: reason === SessionEndReason.Error,
    });

    this.rabbitClient.emit('stop_browser_session', { sessionId }).subscribe({
      error: (err) => this.logger.error(`Помилка відправки stop_browser_session для ${sessionId}`, err),
    });

    this.rooms.emitToSession(sessionId, 'session_ended', { reason, message });
    this.rooms.leaveRoom(sessionId);

    // Користувачам, чию вкладку закрила система, - сповіщення (крім випадку, коли вони самі вийшли).
    if (reason !== SessionEndReason.NoConnections) {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { auction: { select: { title: true } }, account: { select: { title: true } } },
      });
      const userIds = [...new Set(closed.map((c) => c.userId))];
      await Promise.all(
        userIds.map((userId) =>
          this.notificationService.notify(userId, 'SESSION_ENDED', {
            subject: 'Сесію завершено',
            body: `${message}. Аукціон «${session?.auction.title}», акаунт «${session?.account.title}».`,
          }),
        ),
      );
    }
    return true;
  }

  // Завершення адміністратором у «Всіх діях»: SuperAdmin - будь-яку, GA - лише сесію своєї групи.
  async terminateSession(sessionId: string, adminId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { isActive: true } });
    if (!session) throw new NotFoundException('Сесію не знайдено');
    if (!session.isActive) throw new BadRequestException('Ця сесія вже завершена');

    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { role: true },
    });
    if (!admin) throw new ForbiddenException('Користувача не знайдено');

    if (admin.role !== Roles.SuperAdmin) {
      const managedGroupId = admin.role === Roles.Admin ? await managedGroupIdOf(this.prisma, adminId) : undefined;
      const isOwnGroupSession = managedGroupId
        ? await this.prisma.sessionConnection.count({
          where: {
            sessionId,
            disconnectedAt: null,
            OR: [{ userId: adminId }, { user: { userGroupId: managedGroupId } }],
          },
        })
        : 0;
      if (!isOwnGroupSession) {
        throw new ForbiddenException('У вас немає прав для завершення сесії іншої групи');
      }
    }

    await this.endSession(sessionId, SessionEndReason.Admin, { endedById: adminId });
    return this.prisma.session.findUnique({ where: { id: sessionId } });
  }

  // ---------- Активність і таймаути ----------

  // Дія користувача в трансляції (повідомляє воркер): оновлює активність сесії та користувача.
  async touch(sessionId: string, userId?: string) {
    const now = new Date();
    await this.prisma.session.updateMany({ where: { id: sessionId, isActive: true }, data: { lastActivityAt: now } });
    if (userId) {
      await this.prisma.user.updateMany({ where: { id: userId }, data: { lastActivity: now } });
    }
  }

  // Таймаут бездіяльності з глобальних налаштувань (ТЗ 7.4).
  @Cron(CronExpression.EVERY_MINUTE)
  async terminateInactiveSessions() {
    const { inactivityTimeout } = await this.settings.getSettings();
    const threshold = new Date(Date.now() - inactivityTimeout * 60_000);
    const idle = await this.prisma.session.findMany({
      where: { isActive: true, lastActivityAt: { lt: threshold } },
      select: { id: true },
    });
    for (const { id } of idle) {
      await this.endSession(id, SessionEndReason.Inactivity);
    }
  }

  // Страховка лічильників: закриває підключення, чиїх сокетів уже немає (наприклад, після перезапуску API),
  // і завершує сесії без жодного підключення.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileConnections() {
    const staleBefore = new Date(Date.now() - EMPTY_SESSION_GRACE_MS);
    const open = await this.prisma.sessionConnection.findMany({
      where: { disconnectedAt: null, connectedAt: { lt: staleBefore }, session: { isActive: true } },
      select: { id: true, clientId: true },
    });
    const dead = open.filter((c) => !this.rooms.isClientConnected(c.clientId)).map((c) => c.id);
    if (dead.length) {
      await this.prisma.sessionConnection.updateMany({ where: { id: { in: dead } }, data: { disconnectedAt: new Date() } });
    }

    const active = await this.prisma.session.findMany({
      where: { isActive: true, createdAt: { lt: staleBefore } },
      select: { id: true, _count: { select: { connections: { where: { disconnectedAt: null } } } } },
    });
    for (const session of active) {
      if (session._count.connections === 0 && !this.pendingClosures.has(session.id)) {
        await this.endSession(session.id, SessionEndReason.NoConnections);
      } else {
        await this.prisma.session.update({ where: { id: session.id }, data: { activeConnections: session._count.connections } });
      }
    }
  }

  // ---------- Події воркера ----------

  // Браузер сесії не запустився або впав: сесія отримує статус «помилка», вкладки показують помилку.
  async handleWorkerFailure(sessionId: string, errorMessage: string) {
    await this.endSession(sessionId, SessionEndReason.Error, { errorMessage });
  }

  // Воркер перезапустився: усі браузери втрачено.
  async handleWorkerRestart() {
    const active = await this.prisma.session.findMany({ where: { isActive: true }, select: { id: true } });
    for (const { id } of active) {
      await this.endSession(id, SessionEndReason.Error, { errorMessage: 'воркер браузерів перезапущено' });
    }
  }

  // Сесія, до якої підключена вкладка цього клієнта (для перевірки сигналів WebRTC).
  async getClientConnection(sessionId: string, clientId: string) {
    return this.prisma.sessionConnection.findFirst({
      where: { sessionId, clientId, disconnectedAt: null, session: { isActive: true } },
      select: { userId: true, session: { select: { auctionId: true } } },
    });
  }
}
