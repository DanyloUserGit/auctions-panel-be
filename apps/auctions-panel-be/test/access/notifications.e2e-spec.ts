import { Roles } from '@prisma/client';
import { io } from 'socket.io-client';
import { MailService } from '../../src/mail/mail.service';
import { NotificationService } from '../../src/notification/notification.service';
import { RemindersService } from '../../src/notification/reminders.service';
import { api, createTestApp, createUser, resetDatabase, TestContext, TestUser } from './helpers';

// Сповіщення (ТЗ 15): хто отримує, email лише офлайн, нагадування про завершення аукціону.
describe('Notifications', () => {
  let ctx: TestContext;
  let SA: TestUser;
  let GA: TestUser;
  let otherGA: TestUser;
  let groupId: string;
  let send: jest.SpyInstance;

  const inbox = (userId: string, type: string) => ctx.prisma.notification.findMany({ where: { userId, type } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    await ctx.app.get(NotificationService).seedNotificationTypes();
    SA = await createUser(ctx, 'notif-sa', Roles.SuperAdmin);
    GA = await createUser(ctx, 'notif-ga', Roles.Admin);
    otherGA = await createUser(ctx, 'notif-other-ga', Roles.Admin);
    groupId = (await ctx.prisma.userGroup.create({ data: { name: 'Notif group', AdminId: GA.id } })).id;
    send = jest.spyOn(ctx.app.get(MailService), 'send').mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  beforeEach(() => send.mockClear());

  it('adding a user to a group notifies the admin of that group only; email has subject and body in order', async () => {
    const res = await api<any>(ctx, SA, 'POST', '/users', {
      firstName: 'Taras',
      lastName: 'New',
      email: 'new-member@e2e-test.invalid',
      password: 'password-123',
      role: 'User',
      userGroupId: groupId,
    });
    expect(res.status).toBe(201);

    const received = await inbox(GA.id, 'ADDED_TO_GROUP');
    expect(received).toHaveLength(1);
    expect(received[0].message).toContain('new-member@e2e-test.invalid');
    expect(await inbox(otherGA.id, 'ADDED_TO_GROUP')).toHaveLength(0);
    expect(await inbox(res.data.id, 'ADDED_TO_GROUP')).toHaveLength(0);

    expect(send).toHaveBeenCalledWith(GA.email, 'Новий користувач у вашій групі', expect.stringContaining('Notif group'));
  });

  it('worker errors go to Super Admins only', async () => {
    await ctx.app.get(NotificationService).notifySuperAdmins('WORKER_ERROR', { subject: 'Збій', body: 'browser crashed' });
    expect(await inbox(SA.id, 'WORKER_ERROR')).toHaveLength(1);
    expect(await inbox(GA.id, 'WORKER_ERROR')).toHaveLength(0);
  });

  it('email is not sent to a user who is online; a mail failure does not break anything', async () => {
    const token = ctx.jwt.sign({ id: SA.id, email: SA.email, role: SA.role });
    const socket = io(`${ctx.baseUrl}/notifications`, { transports: ['websocket'], extraHeaders: { Cookie: `access_token=${token}` } });
    await new Promise((resolve) => socket.on('connect', resolve));
    await new Promise((resolve) => setTimeout(resolve, 200));

    await ctx.app.get(NotificationService).notifySuperAdmins('WORKER_ERROR', { subject: 'Збій 2', body: 'again' });
    expect(send).not.toHaveBeenCalled();
    socket.close();

    send.mockRejectedValueOnce(new Error('SendGrid down'));
    await expect(
      ctx.app.get(NotificationService).notifyUsers([GA.id], 'SESSION_ENDED', { subject: 's', body: 'b' }),
    ).resolves.not.toThrow();
  });

  it('a user sets «remind N before the end» and gets the reminder', async () => {
    const settings = await api<any[]>(ctx, GA, 'GET', '/notifications/settings');
    const auctionEnded = settings.data.find((s) => s.notificationType.name === 'AUCTION_ENDED');
    expect(auctionEnded).toBeDefined();
    expect((await api(ctx, GA, 'PATCH', '/notifications/settings', { typeId: auctionEnded.notificationTypeId, value: 1800 })).status).toBe(200);

    const endsAt = new Date(Date.now() + 20 * 60 * 1000);
    const created = await api<any>(ctx, GA, 'POST', '/notifications/reminders', { title: 'Bmw X5, лот 42', endsAt: endsAt.toISOString() });
    expect(created.status).toBe(201);
    expect(new Date(created.data.remindAt).getTime()).toBeLessThanOrEqual(Date.now());

    await ctx.app.get(RemindersService).sendDue();
    const reminders = await inbox(GA.id, 'AUCTION_ENDED');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].message).toContain('Bmw X5, лот 42');
    expect((await api<any[]>(ctx, GA, 'GET', '/notifications/reminders')).data[0].sentAt).not.toBeNull();
  });

  it('seeding is not public', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/notifications/seed`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
