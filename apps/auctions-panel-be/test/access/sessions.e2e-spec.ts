import { Roles } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import { SessionDispatcherService } from '../../src/session-logger/session-dispatcher.service';
import { SessionsService } from '../../src/sessions/sessions.service';
import { api, catalog, createTestApp, createUser, resetDatabase, TestContext, TestUser } from './helpers';

type Joined = { socket: Socket; sessionId?: string; error?: string };

// Сесії (ТЗ 7, 10): автопідключення, кілька вкладок, ліміти, таймаут, «Всі дії».
describe('Sessions: connections, limits, dispatcher', () => {
  let ctx: TestContext;
  let SA: TestUser;
  let GA: TestUser;
  let otherGA: TestUser;
  let members: TestUser[];
  let groupId: string;
  let auctionId: string;
  let accounts: { id: string }[];
  const sockets: Socket[] = [];

  // Вкладка, що лишається відкритою (сокет не закривається після підключення).
  async function openTab(user: TestUser, auctionAuthId: string, sessionId?: string): Promise<Joined> {
    const token = ctx.jwt.sign({ id: user.id, email: user.email, role: user.role });
    const socket = io(ctx.baseUrl, { transports: ['websocket'], extraHeaders: { Cookie: `access_token=${token}` }, reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    const requestId = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      socket.on('session_ready', (d: { sessionId: string; requestId?: string }) => {
        if (d.requestId === requestId) resolve({ socket, sessionId: d.sessionId });
      });
      socket.on('session_error', (e: { message: string; requestId?: string }) => {
        if (e.requestId === requestId) resolve({ socket, error: e.message });
      });
      socket.emit('join_auction', { auctionId, auctionAuthId, width: 800, height: 600, sessionId, requestId });
    });
  }

  const closeAll = async () => {
    sockets.splice(0).forEach((s) => s.close());
    await ctx.prisma.sessionConnection.updateMany({ where: { disconnectedAt: null }, data: { disconnectedAt: new Date() } });
    await ctx.prisma.session.updateMany({ where: { isActive: true }, data: { isActive: false, endedAt: new Date() } });
  };

  const setSettings = (body: Record<string, unknown>) => api(ctx, SA, 'PATCH', '/global-settings', body);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    SA = await createUser(ctx, 'sess-sa', Roles.SuperAdmin);
    GA = await createUser(ctx, 'sess-ga', Roles.Admin);
    otherGA = await createUser(ctx, 'sess-other-ga', Roles.Admin);
    groupId = (await ctx.prisma.userGroup.create({ data: { name: 'Sessions group', AdminId: GA.id } })).id;
    await ctx.prisma.userGroup.create({ data: { name: 'Other sessions group', AdminId: otherGA.id } });
    members = await Promise.all(['sess-m1', 'sess-m2', 'sess-m3'].map((k) => createUser(ctx, k, Roles.User, { userGroupId: groupId })));

    const cat = catalog(ctx, SA);
    const ag = await cat.auctionGroup('Sessions AG');
    const auction = await cat.auction('SessAuction', ag.id);
    auctionId = auction.id;
    accounts = [await cat.account('sess-acc-1', auction.id), await cat.account('sess-acc-2', auction.id)];
    await cat.grantGroup(groupId, 'auction-group', ag.id);
    await cat.grantGroup(groupId, 'auction', auction.id);
    for (const acc of accounts) await cat.grantGroup(groupId, 'account', acc.id);
  });

  afterEach(async () => {
    await closeAll();
    await setSettings({ sessionMaxConnections: 5, globalSessionLimit: 100 });
  });

  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await ctx?.app.close();
  });

  it('К-7: a full session makes the next user start a new one automatically', async () => {
    await setSettings({ sessionMaxConnections: 2 });
    const [a, b, c] = [await openTab(members[0], accounts[0].id), await openTab(members[1], accounts[0].id), await openTab(members[2], accounts[0].id)];
    expect(a.sessionId).toBeDefined();
    expect(b.sessionId).toBe(a.sessionId);
    expect(c.error).toBeUndefined();
    expect(c.sessionId).not.toBe(a.sessionId);

    const counts = await ctx.prisma.session.findMany({ where: { auctionAuthId: accounts[0].id, isActive: true }, select: { activeConnections: true } });
    expect(counts.map((s) => s.activeConnections).sort()).toEqual([1, 2]);
  });

  it('К-8: one user keeps several tabs; all of them are restored', async () => {
    const t1 = await openTab(members[0], accounts[0].id);
    const t2 = await openTab(members[0], accounts[1].id);
    expect(t1.sessionId).not.toBe(t2.sessionId);

    const mine = await api<any[]>(ctx, members[0], 'GET', '/sessions/active/mine');
    expect(mine.data.map((s) => s.id).sort()).toEqual([t1.sessionId, t2.sessionId].sort());
    expect(mine.data.map((s) => s.accountTitle).sort()).toEqual(['sess-acc-1', 'sess-acc-2']);
  });

  it('К-8: the same account opened twice by one user reuses the tab; leaving decrements the counter', async () => {
    const t1 = await openTab(members[0], accounts[0].id);
    const again = await openTab(members[0], accounts[0].id, t1.sessionId);
    expect(again.sessionId).toBe(t1.sessionId);

    const b = await openTab(members[1], accounts[0].id);
    expect(b.sessionId).toBe(t1.sessionId);
    b.socket.emit('leave_auction', { sessionId: b.sessionId });
    await new Promise((r) => setTimeout(r, 300));
    const session = await ctx.prisma.session.findUniqueOrThrow({ where: { id: t1.sessionId } });
    expect(session.isActive).toBe(true);
    expect(session.activeConnections).toBeGreaterThanOrEqual(1);
    expect(await ctx.prisma.sessionConnection.count({ where: { sessionId: t1.sessionId, userId: members[1].id, disconnectedAt: null } })).toBe(0);
  });

  it('К-10: personal, group and global limits', async () => {
    await ctx.prisma.user.update({ where: { id: members[0].id }, data: { sessionLimit: 1 } });
    expect((await openTab(members[0], accounts[0].id)).sessionId).toBeDefined();
    expect((await openTab(members[0], accounts[1].id)).error).toMatch(/ваш ліміт/);
    await ctx.prisma.user.update({ where: { id: members[0].id }, data: { sessionLimit: 0 } });
    await closeAll();

    await ctx.prisma.userGroup.update({ where: { id: groupId }, data: { sessionLimit: 1 } });
    expect((await openTab(members[0], accounts[0].id)).sessionId).toBeDefined();
    expect((await openTab(members[1], accounts[1].id)).error).toMatch(/ліміт одночасних сесій групи/);
    await ctx.prisma.userGroup.update({ where: { id: groupId }, data: { sessionLimit: 0 } });
    await closeAll();

    await setSettings({ globalSessionLimit: 1 });
    expect((await openTab(SA, accounts[0].id)).sessionId).toBeDefined();
    expect((await openTab(SA, accounts[1].id)).error).toMatch(/загальний ліміт/);
  });

  it('К-10: sessions end after the inactivity timeout, activity keeps them alive', async () => {
    const service = ctx.app.get(SessionsService);
    const idle = await openTab(members[0], accounts[0].id);
    const busy = await openTab(members[1], accounts[1].id);
    const ended = new Promise((resolve) => idle.socket.on('session_ended', resolve));

    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await ctx.prisma.session.updateMany({ where: { id: { in: [idle.sessionId!, busy.sessionId!] } }, data: { lastActivityAt: old } });
    await service.touch(busy.sessionId!, members[1].id);
    await service.terminateInactiveSessions();

    expect(await ended).toMatchObject({ sessionId: idle.sessionId, reason: 'Inactivity' });
    const [idleRow, busyRow] = await Promise.all([
      ctx.prisma.session.findUniqueOrThrow({ where: { id: idle.sessionId } }),
      ctx.prisma.session.findUniqueOrThrow({ where: { id: busy.sessionId } }),
    ]);
    expect(idleRow).toMatchObject({ isActive: false, endReason: 'Inactivity' });
    expect(busyRow.isActive).toBe(true);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: members[1].id } })).lastActivity).not.toBeNull();
  });

  it('К-5: GA sees and ends sessions of the own group only; SA sees all', async () => {
    const memberTab = await openTab(members[0], accounts[0].id);

    const gaView = await api<{ data: any[] }>(ctx, GA, 'GET', '/dispatcher/sessions?isActive=true');
    expect(gaView.status).toBe(200);
    expect(gaView.data.data.map((s) => s.id)).toEqual([memberTab.sessionId]);
    expect(gaView.data.data[0]).toMatchObject({
      status: 'active',
      activeConnections: 1,
      account: { title: 'sess-acc-1' },
      users: [expect.objectContaining({ id: members[0].id, isConnected: true })],
    });

    const otherView = await api<{ data: any[] }>(ctx, otherGA, 'GET', '/dispatcher/sessions?isActive=true');
    expect(otherView.data.data).toEqual([]);
    expect((await api(ctx, otherGA, 'DELETE', `/sessions/${memberTab.sessionId}`)).status).toBe(403);

    const logs = await api<any[]>(ctx, GA, 'GET', `/dispatcher/logs?sessionId=${memberTab.sessionId}`);
    expect(logs.data.length).toBeGreaterThan(0);
    expect(logs.data[0].session.auction.title).toBe('SessAuction');
    expect((await api<any[]>(ctx, otherGA, 'GET', `/dispatcher/logs?sessionId=${memberTab.sessionId}`)).data).toEqual([]);

    const search = await api<{ data: any[] }>(ctx, SA, 'GET', `/dispatcher/sessions?search=${memberTab.sessionId}`);
    expect(search.data.data.map((s) => s.id)).toEqual([memberTab.sessionId]);
    const byUserGroup = await api<{ data: any[] }>(ctx, SA, 'GET', `/dispatcher/sessions?userGroupId=${groupId}&isActive=true`);
    expect(byUserGroup.data.data.map((s) => s.id)).toEqual([memberTab.sessionId]);

    const ended = new Promise((resolve) => memberTab.socket.on('session_ended', resolve));
    expect((await api(ctx, GA, 'DELETE', `/sessions/${memberTab.sessionId}`)).status).toBe(200);
    expect(await ended).toMatchObject({ reason: 'Admin' });
    const row = await ctx.prisma.session.findUniqueOrThrow({ where: { id: memberTab.sessionId } });
    expect(row).toMatchObject({ isActive: false, endReason: 'Admin', endedById: GA.id, activeConnections: 0 });
  });

  it('В-2: history and logs are kept for the configured retention; 0 keeps them forever', async () => {
    const dispatcher = ctx.app.get(SessionDispatcherService);
    const old = await ctx.prisma.session.create({
      data: {
        auctionId,
        auctionAuthId: accounts[0].id,
        maxConnections: 5,
        activeConnections: 0,
        isActive: false,
        endedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
        logs: { create: { eventType: 'ForbiddenAction', message: 'old forbidden', isIncident: true } },
      },
    });
    const recent = await ctx.prisma.session.create({
      data: { auctionId, auctionAuthId: accounts[0].id, maxConnections: 5, activeConnections: 0, isActive: false, endedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });

    await setSettings({ sessionRetentionDays: 0 });
    await dispatcher.cleanupOldSessions();
    expect(await ctx.prisma.session.count({ where: { id: old.id } })).toBe(1);

    await setSettings({ sessionRetentionDays: 365 });
    await dispatcher.cleanupOldSessions();
    expect(await ctx.prisma.session.count({ where: { id: old.id } })).toBe(0);
    expect(await ctx.prisma.session.count({ where: { id: recent.id } })).toBe(1);
  });

  it('С-11: stream quality from the global settings is sent to the worker', async () => {
    const worker = ctx.app.get('WORKER_SERVICE');
    const emit = jest.spyOn(worker, 'emit');
    await setSettings({ streamFps: 20, streamQuality: 95, streamBitrateKbps: 6000 });
    await openTab(members[0], accounts[1].id);
    const start = emit.mock.calls.find(([pattern]) => pattern === 'start_browser_session');
    expect(start?.[1]).toMatchObject({ stream: { fps: 20, quality: 95, bitrateKbps: 6000 } });
    expect(start?.[1]).not.toHaveProperty('forbiddenSelectors');
    emit.mockRestore();
    await setSettings({ streamFps: 15, streamQuality: 90, streamBitrateKbps: 4000 });
  });

  it('С-12: auction proxy is stored encrypted, never returned, and passed to the worker', async () => {
    const res = await api<any>(ctx, SA, 'PATCH', `/auctions/${auctionId}`, { proxyUrl: 'http://proxy-user:p%40ss@proxy.e2e-test.invalid:3128' });
    expect(res.status).toBe(200);
    expect(res.data).not.toHaveProperty('proxyUrl');
    expect(res.data.proxyHost).toBe('http://proxy.e2e-test.invalid:3128');
    const stored = await ctx.prisma.auction.findUniqueOrThrow({ where: { id: auctionId }, omit: { proxyUrl: false } });
    expect(stored.proxyUrl).not.toContain('proxy-user');

    const emit = jest.spyOn(ctx.app.get('WORKER_SERVICE'), 'emit');
    await openTab(members[0], accounts[0].id);
    const start = emit.mock.calls.find(([pattern]) => pattern === 'start_browser_session');
    expect(start?.[1]).toMatchObject({
      proxy: { server: 'http://proxy.e2e-test.invalid:3128', username: 'proxy-user', password: 'p@ss' },
    });
    emit.mockRestore();
    expect((await api(ctx, SA, 'PATCH', `/auctions/${auctionId}`, { proxyUrl: 'ftp://bad' })).status).toBe(400);
    await api(ctx, SA, 'PATCH', `/auctions/${auctionId}`, { proxyUrl: '' });
  });

  it('С-6: a worker failure ends the session with the «error» status', async () => {
    const tab = await openTab(members[2], accounts[1].id);
    await ctx.app.get(SessionsService).handleWorkerFailure(tab.sessionId!, 'browser crashed');
    const view = await api<{ data: any[] }>(ctx, SA, 'GET', '/dispatcher/sessions?status=error');
    expect(view.data.data.map((s) => s.id)).toContain(tab.sessionId);
    expect(view.data.data.find((s) => s.id === tab.sessionId).errorMessage).toBe('browser crashed');
  });
});
