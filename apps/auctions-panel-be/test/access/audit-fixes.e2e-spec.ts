import { Roles } from '@prisma/client';
import { api, createTestApp, createUser, resetDatabase, TestContext, TestUser } from './helpers';
import { AuthService } from '../../src/auth/auth.service';
import { SessionLoggerService } from '../../src/session-logger/session-logger.service';
import { hashPassword } from '../../src/utils/password';
import { SessionRulesService } from '../../src/sessions/session-rules.service';

// Перевірки виправлень з docs/audit.md, що стосуються адміністрування користувачів і груп.
describe('Audit fixes: users and groups', () => {
  let ctx: TestContext;
  let SA: TestUser;
  let GA: TestUser;
  let groupId: string;
  let otherGroupId: string;
  let otherMember: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    SA = await createUser(ctx, 'audit-sa', Roles.SuperAdmin);
    GA = await createUser(ctx, 'audit-ga', Roles.Admin);
    groupId = (await ctx.prisma.userGroup.create({ data: { name: 'GA group', AdminId: GA.id } })).id;
    otherGroupId = (await ctx.prisma.userGroup.create({ data: { name: 'Other group' } })).id;
    otherMember = await createUser(ctx, 'audit-other-member', Roles.User, { userGroupId: otherGroupId });
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  describe('В-12: creating a worker never answers 500', () => {
    const worker = (email: string, extra: Record<string, unknown> = {}) => ({
      firstName: 'Ivan',
      lastName: 'Petrenko',
      email,
      password: 'password-123',
      role: 'User',
      userGroupId: groupId,
      ...extra,
    });

    it('invalid data - 400 with the reason', async () => {
      const res = await api<any>(ctx, SA, 'POST', '/users', worker('not-an-email'));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.data.message)).toContain('email');
    });

    it('duplicate email - 409', async () => {
      expect((await api(ctx, SA, 'POST', '/users', worker('dup@e2e-test.invalid'))).status).toBe(201);
      const again = await api<any>(ctx, SA, 'POST', '/users', worker('dup@e2e-test.invalid'));
      expect(again.status).toBe(409);
    });
  });

  describe('К-6: access statuses', () => {
    let memberId: string;

    it('status can be chosen on creation and is journaled', async () => {
      const res = await api<any>(ctx, GA, 'POST', '/users', {
        firstName: 'Olena',
        lastName: 'Status',
        email: 'status@e2e-test.invalid',
        password: 'password-123',
        role: 'User',
        accessStatus: 'Purchase',
        statusReason: 'депозит внесено',
      });
      expect(res.status).toBe(201);
      expect(res.data.accessStatus).toBe('Purchase');
      memberId = res.data.id;
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'user.create', targetUserId: memberId } });
      expect(audit?.message).toContain('Дозволені покупки');
      expect(audit?.actorId).toBe(GA.id);
    });

    it('changing the status requires a reason and writes the old/new status', async () => {
      expect((await api(ctx, GA, 'PATCH', `/users/${memberId}/status`, { accessStatus: 'PurchaseSale' })).status).toBe(400);
      const ok = await api<any>(ctx, GA, 'PATCH', `/users/${memberId}/status`, { accessStatus: 'PurchaseSale', reason: 'підписано договір' });
      expect(ok.status).toBe(200);
      expect(ok.data.accessStatus).toBe('PurchaseSale');
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'user.status', targetUserId: memberId } });
      expect(audit?.message).toMatch(/Дозволені покупки» → «Дозволені покупки \+ дозволені продажі.*підписано договір/);
    });

    it('GA cannot change the status of a user from another group; the edit form cannot change it at all', async () => {
      expect((await api(ctx, GA, 'PATCH', `/users/${SA.id}/status`, { isBlocked: true, reason: 'test test' })).status).toBe(403);
      await api(ctx, SA, 'PATCH', `/users/${memberId}`, { accessStatus: 'ReadOnly' });
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: memberId } });
      expect(user.accessStatus).toBe('PurchaseSale');
    });

    it('buy buttons are unlocked only for purchase statuses', async () => {
      const rules = ctx.app.get(SessionRulesService);
      const auction = await ctx.prisma.auction.create({
        data: {
          title: 'Rules',
          url: 'https://rules.e2e-test.invalid/',
          forbiddenSelectors: { create: [{ selector: '#buy', isBuyAction: true }, { selector: '#delete' }] },
        },
      });
      expect((await rules.forUser(memberId, auction.id)).forbiddenSelectors).toEqual(['#delete']);
      await ctx.prisma.user.update({ where: { id: memberId }, data: { accessStatus: 'ReadOnly' } });
      expect((await rules.forUser(memberId, auction.id)).forbiddenSelectors.sort()).toEqual(['#buy', '#delete']);
    });
  });

  describe('В-1 / В-11: logins, activity and admin actions are journaled', () => {
    const login = (email: string, password: string) =>
      fetch(`${ctx.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, token: 'test' }),
      });

    beforeAll(async () => {
      jest.spyOn(ctx.app.get(AuthService), 'verifyTurnstileToken').mockResolvedValue(undefined);
      await ctx.prisma.user.update({ where: { id: GA.id }, data: { password: await hashPassword('ga-password-1') } });
    });

    it('failed logins get one message for unknown email and wrong password, and are journaled', async () => {
      const unknown = await login('nobody@e2e-test.invalid', 'whatever-123');
      const wrong = await login(GA.email, 'wrong-password');
      expect(unknown.status).toBe(403);
      expect(wrong.status).toBe(403);
      expect((await unknown.json()).message).toBe((await wrong.json()).message);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'login.failed', targetUserId: GA.id } })).toBe(1);
    });

    it('a successful login sets the last login and is journaled', async () => {
      expect((await login(GA.email, 'ga-password-1')).status).toBe(201);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: GA.id } });
      expect(user.lastLogin).not.toBeNull();
      expect(user.lastActivity).not.toBeNull();
      const journal = await api<any[]>(ctx, SA, 'GET', `/audit-log?category=Auth&userId=${GA.id}`);
      expect(journal.data.map((e) => e.action)).toEqual(expect.arrayContaining(['login.success', 'login.failed']));
    });

    it('admin actions are journaled without secrets; GA sees only the own group', async () => {
      await api(ctx, SA, 'POST', '/auctions', { title: 'Journaled', url: 'https://journaled.e2e-test.invalid/' });
      const auctions = await api<any[]>(ctx, SA, 'GET', '/audit-log?category=Admin&search=Journaled');
      expect(auctions.data[0]).toMatchObject({ action: 'catalog.auction.create', actor: { id: SA.id } });

      const auctionId = (await ctx.prisma.auction.findFirstOrThrow({ where: { title: 'Journaled' } })).id;
      await api(ctx, SA, 'POST', '/auction-auth', { title: 'secret-acc', email: 'acc@e2e-test.invalid', password: 'super-secret-9', auctionId });
      const accounts = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.account.create' } });
      expect(JSON.stringify(accounts)).not.toContain('super-secret-9');

      const gaView = await api<any[]>(ctx, GA, 'GET', '/audit-log?category=Admin');
      expect(gaView.data.some((e) => e.action === 'catalog.auction.create')).toBe(false);
    });
  });

  describe('В-10: control card', () => {
    let member: TestUser;

    beforeAll(async () => {
      member = await createUser(ctx, 'card-member', Roles.User, { userGroupId: groupId });
    });

    it('GA fills the admin fields; the user cannot change them', async () => {
      const res = await api(ctx, GA, 'PATCH', `/users/${member.id}`, {
        middleName: 'Петрович',
        hasContract: true,
        contractNumber: 'Д-15',
        depositAmount: 1500,
        depositMethod: 'готівка',
        adminComment: 'надійний',
      });
      expect(res.status).toBe(200);
      expect((await api(ctx, member, 'PATCH', `/users/${member.id}`, { adminComment: 'змінив сам' })).status).toBe(403);
    });

    it('shows admin fields, limits and the last incidents to GA only', async () => {
      const session = await ctx.prisma.session.create({
        data: {
          auction: { create: { title: 'Card auction', url: 'https://card.e2e-test.invalid/' } },
          account: { create: { title: 'card', email: 'x', password: 'x', auction: { create: { title: 'tmp', url: 'https://tmp.e2e-test.invalid/' } } } },
          maxConnections: 5,
          activeConnections: 0,
          isActive: false,
        },
      });
      await ctx.prisma.sessionLog.create({
        data: { sessionId: session.id, userId: member.id, eventType: 'ForbiddenAction', message: 'blocked #buy', isIncident: true },
      });

      const card = await api<any>(ctx, GA, 'GET', `/users/${member.id}/control-card`);
      expect(card.data.profile.fullName).toBe('card-member Петрович E2E');
      expect(card.data.admin).toMatchObject({ hasContract: true, contractNumber: 'Д-15', depositAmount: 1500, adminComment: 'надійний' });
      expect(card.data.limits).toMatchObject({ sessionLimit: 0, groupSessionLimit: 0 });
      expect(card.data.recentIncidents.map((i: any) => i.message)).toEqual(['blocked #buy']);

      const own = await api<any>(ctx, member, 'GET', `/users/${member.id}/control-card`);
      expect(own.data.admin).toBeNull();
      expect(own.data.recentIncidents).toEqual([]);
    });
  });

  describe('С-19: training materials', () => {
    it('SA creates for everyone; GA creates for the own group and sees it; other groups do not', async () => {
      const common = await api<any>(ctx, SA, 'POST', '/training/materials', { title: 'Для всіх', content: '<p>x</p>', isPublished: true });
      expect(common.status).toBe(201);
      const own = await api<any>(ctx, GA, 'POST', '/training/materials', { title: 'Для групи GA', content: '<p>y</p>', visibility: 'All', groupId: otherGroupId });
      expect(own.status).toBe(201);
      expect(own.data).toMatchObject({ visibility: 'Group', groupId });

      const titles = async (user: TestUser) => (await api<any[]>(ctx, user, 'GET', '/training/materials')).data.map((m) => m.title);
      expect(await titles(GA)).toEqual(expect.arrayContaining(['Для всіх', 'Для групи GA']));

      const member = await createUser(ctx, 'training-member', Roles.User, { userGroupId: groupId });
      expect(await titles(member)).not.toContain('Для групи GA'); // ще не опубліковано
      expect((await api(ctx, GA, 'PATCH', `/training/materials/${own.data.id}/publish`, { isPublished: true })).status).toBe(200);
      expect(await titles(member)).toContain('Для групи GA');
      expect(await titles(otherMember)).not.toContain('Для групи GA');

      expect((await api(ctx, GA, 'PATCH', `/training/materials/${common.data.id}/publish`, { isPublished: false })).status).toBe(403);
    });
  });

  describe('С-10: GA assigns co-admins; logging policy', () => {
    const admin = (email: string) => ({
      firstName: 'Co',
      lastName: 'Admin',
      email,
      password: 'password-123',
      role: 'Admin',
    });

    it('GA creates another GA of the own group only when Super Admin allows it', async () => {
      expect((await api(ctx, GA, 'POST', '/users', admin('co-1@e2e-test.invalid'))).status).toBe(403);
      await api(ctx, SA, 'PATCH', '/global-settings', { gaCanAssignGa: true });
      expect((await api<any>(ctx, GA, 'GET', '/global-settings/features')).data).toEqual({ gaCanAssignGa: true });

      const created = await api<any>(ctx, GA, 'POST', '/users', admin('co-2@e2e-test.invalid'));
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ role: 'Admin', userGroupId: groupId });

      const coAdmin = { id: created.data.id, email: created.data.email, role: Roles.Admin };
      const me = await api<any>(ctx, coAdmin, 'GET', '/auth/me');
      expect(me.data.managedGroup.id).toBe(groupId);
      const members = await api<any[]>(ctx, coAdmin, 'GET', '/users');
      expect(members.status).toBe(200);
      expect(members.data.length).toBeGreaterThan(0);
      const worker = await api<any>(ctx, coAdmin, 'POST', '/users', { ...admin('co-member@e2e-test.invalid'), role: 'User' });
      expect(worker.data.userGroupId).toBe(groupId);
      await api(ctx, SA, 'PATCH', '/global-settings', { gaCanAssignGa: false });
    });

    it('logging policy drops low-importance service events, never user actions', async () => {
      const logger = ctx.app.get(SessionLoggerService);
      const session = await ctx.prisma.session.create({
        data: {
          auction: { create: { title: 'Policy', url: 'https://policy.e2e-test.invalid/' } },
          account: { create: { title: 'p', email: 'p', password: 'p', auction: { create: { title: 'tmp2', url: 'https://tmp2.e2e-test.invalid/' } } } },
          maxConnections: 5,
          activeConnections: 0,
          isActive: false,
        },
      });
      await api(ctx, SA, 'PATCH', '/global-settings', { loggingPolicy: 'Warning' });
      (logger as any).policy = null;
      await logger.logEvent({ sessionId: session.id, eventType: 'Other', severity: 'Info', message: 'noise' });
      await logger.logEvent({ sessionId: session.id, eventType: 'Navigation', severity: 'Info', message: 'page' });
      await logger.logEvent({ sessionId: session.id, eventType: 'Other', severity: 'Warning', message: 'warn' });
      const messages = (await ctx.prisma.sessionLog.findMany({ where: { sessionId: session.id } })).map((l) => l.message).sort();
      expect(messages).toEqual(['page', 'warn']);
      await api(ctx, SA, 'PATCH', '/global-settings', { loggingPolicy: 'Info' });
    });
  });

  describe('С-1 / С-3: rule levels and allowed pages', () => {
    it('global, group and user rules combine with «user > group» priority', async () => {
      const rules = ctx.app.get(SessionRulesService);
      const auction = await ctx.prisma.auction.create({
        data: {
          title: 'Levels',
          url: 'https://levels.e2e-test.invalid/',
          forbiddenSelectors: { create: [{ selector: '#auction-rule' }] },
          allowedRoutes: { create: [{ path: '/catalog' }] },
        },
      });
      const member = await createUser(ctx, 'levels-member', Roles.User, { userGroupId: groupId });
      const outsiderUser = await createUser(ctx, 'levels-outsider', Roles.User, { userGroupId: otherGroupId });

      const add = (user: TestUser, body: Record<string, unknown>) => api<any>(ctx, user, 'POST', '/access-rules', body);
      expect((await add(SA, { kind: 'Route', value: '/global/' })).status).toBe(201);
      expect((await add(SA, { kind: 'Selector', value: '#group-rule', userGroupId: groupId, auctionId: auction.id })).status).toBe(201);
      expect((await add(SA, { kind: 'Route', value: '/global/', effect: 'Allow', userId: member.id })).status).toBe(201);

      const forMember = await rules.forUser(member.id, auction.id);
      expect(forMember.forbiddenRoutes).not.toContain('/global/');
      expect(forMember.forbiddenSelectors.sort()).toEqual(['#auction-rule', '#group-rule']);
      expect(forMember.allowedRoutes).toEqual(['/catalog']);

      const forOutsider = await rules.forUser(outsiderUser.id, auction.id);
      expect(forOutsider.forbiddenRoutes).toContain('/global/');
      expect(forOutsider.forbiddenSelectors).toEqual(['#auction-rule']);
    });

    it('GA manages rules of the own group only when allowed', async () => {
      const body = { kind: 'Selector', value: '#ga-rule', userGroupId: groupId };
      expect((await api(ctx, GA, 'POST', '/access-rules', body)).status).toBe(403);
      await ctx.prisma.userGroup.update({ where: { id: groupId }, data: { canGaManageRules: true } });
      expect((await api(ctx, GA, 'POST', '/access-rules', body)).status).toBe(201);
      expect((await api(ctx, GA, 'POST', '/access-rules', { ...body, userGroupId: otherGroupId })).status).toBe(403);
      expect((await api(ctx, GA, 'POST', '/access-rules', { kind: 'Route', value: '/x/' })).status).toBe(400);
      const list = await api<any>(ctx, GA, 'GET', '/access-rules');
      expect(list.data.canManage).toBe(true);
      expect(list.data.rules.every((r: any) => r.userGroupId === groupId || r.user)).toBe(true);
    });
  });

  describe('С-2 / С-17: auction rules', () => {
    it('forbidden routes accept paths and patterns, not «/»', async () => {
      const auction = await api<any>(ctx, SA, 'POST', '/auctions', { title: 'Paths', url: 'https://paths.e2e-test.invalid/' });
      for (const path of ['/en-es/_orders/', '*orders*', 'https://paths.e2e-test.invalid/cart/']) {
        expect((await api(ctx, SA, 'POST', `/auctions/${auction.data.id}/forbidden`, { path })).status).toBe(201);
      }
      expect((await api(ctx, SA, 'POST', `/auctions/${auction.data.id}/forbidden`, { path: '/' })).status).toBe(400);
      expect((await api(ctx, SA, 'POST', `/auctions/${auction.data.id}/forbidden`, { path: '*' })).status).toBe(400);
    });

    it('an auction with rules and history can be deleted; with active sessions it cannot', async () => {
      const auction = await api<any>(ctx, SA, 'POST', '/auctions', { title: 'Delete me', url: 'https://delete.e2e-test.invalid/' });
      const id = auction.data.id;
      await api(ctx, SA, 'POST', `/auctions/${id}/forbidden`, { path: '/orders/' });
      await api(ctx, SA, 'POST', `/auctions/${id}/allowed`, { path: 'https://delete.e2e-test.invalid/list' });
      await api(ctx, SA, 'POST', `/auctions/${id}/selector`, { selector: '#buy' });
      const account = await api<any>(ctx, SA, 'POST', '/auction-auth', { title: 'del', email: 'del@e2e-test.invalid', password: 'secret-123', auctionId: id });
      const session = await ctx.prisma.session.create({
        data: { auctionId: id, auctionAuthId: account.data.id, maxConnections: 5, activeConnections: 1, isActive: true },
      });

      expect((await api(ctx, SA, 'DELETE', `/auctions/${id}`)).status).toBe(409);
      await ctx.prisma.session.update({ where: { id: session.id }, data: { isActive: false } });
      expect((await api(ctx, SA, 'DELETE', `/auctions/${id}`)).status).toBe(200);
      expect(await ctx.prisma.forbiddenSelector.count({ where: { auctionId: id } })).toBe(0);
    });
  });

  describe('К-4: GA cannot change group membership', () => {
    it('users[] from GA is ignored', async () => {
      const res = await api(ctx, GA, 'PATCH', `/user-groups/${groupId}`, { name: 'GA group', users: [otherMember.id, SA.id] });
      expect(res.status).toBe(200);
      const moved = await ctx.prisma.user.findMany({ where: { id: { in: [otherMember.id, SA.id] } }, select: { userGroupId: true } });
      expect(moved.map((u) => u.userGroupId)).toEqual(expect.not.arrayContaining([groupId]));
    });

    it('SuperAdmin still can', async () => {
      const res = await api(ctx, SA, 'PATCH', `/user-groups/${groupId}`, { users: [otherMember.id] });
      expect(res.status).toBe(200);
      const moved = await ctx.prisma.user.findUnique({ where: { id: otherMember.id }, select: { userGroupId: true } });
      expect(moved?.userGroupId).toBe(groupId);
    });
  });
});
