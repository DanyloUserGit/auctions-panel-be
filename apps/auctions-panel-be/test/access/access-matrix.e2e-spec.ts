import { Roles } from '@prisma/client';
import {
  api,
  catalog,
  createTestApp,
  createUser,
  joinAuction,
  resetDatabase,
  TestContext,
  TestUser,
  titles,
} from './helpers';

// UserGroup → AuctionGroup → Auction → Account: every level must be enabled explicitly.
describe('Access matrix (user groups)', () => {
  let ctx: TestContext;
  let SA: TestUser, adminA: TestUser, uA: TestUser, uB: TestUser, uC: TestUser, uNone: TestUser;
  let gA: { id: string }, gB: { id: string };
  const c: Record<string, { id: string }> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);

    SA = await createUser(ctx, 'superadmin', Roles.SuperAdmin);
    adminA = await createUser(ctx, 'admin-a', Roles.Admin);
    const adminB = await createUser(ctx, 'admin-b', Roles.Admin);
    gA = await ctx.prisma.userGroup.create({ data: { name: 'Group A', AdminId: adminA.id } });
    gB = await ctx.prisma.userGroup.create({ data: { name: 'Group B', AdminId: adminB.id } });
    const gC = await ctx.prisma.userGroup.create({ data: { name: 'Group C (blocked)', isActive: false } });
    uA = await createUser(ctx, 'user-a', Roles.User, { userGroupId: gA.id });
    uB = await createUser(ctx, 'user-b', Roles.User, { userGroupId: gB.id });
    uC = await createUser(ctx, 'user-c', Roles.User, { userGroupId: gC.id });
    uNone = await createUser(ctx, 'user-none', Roles.User);

    const cat = catalog(ctx, SA);
    c.EU = await cat.auctionGroup('Europe');
    c.US = await cat.auctionGroup('America');
    c.CN = await cat.auctionGroup('China');
    c.E1 = await cat.auction('E1', c.EU.id);
    c.E2 = await cat.auction('E2', c.EU.id);
    c.E3 = await cat.auction('E3', c.EU.id);
    c.U1 = await cat.auction('U1', c.US.id);
    c.C1 = await cat.auction('C1', c.CN.id);
    c.acc11 = await cat.account('acc11', c.E1.id);
    c.acc12 = await cat.account('acc12', c.E1.id);
    c.acc21 = await cat.account('acc21', c.E2.id);
    c.acc31 = await cat.account('acc31', c.E3.id);
    c.accU1 = await cat.account('accU1', c.U1.id);
    c.accC1 = await cat.account('accC1', c.C1.id);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('does not enable new auction groups, auctions or accounts for any user group', async () => {
    const groups = await ctx.prisma.userGroup.findMany({
      select: { _count: { select: { allowedAuctionGroups: true, allowedAuctions: true, allowedAccounts: true } } },
    });
    for (const g of groups) {
      expect(g._count).toEqual({ allowedAuctionGroups: 0, allowedAuctions: 0, allowedAccounts: 0 });
    }
  });

  describe('after SuperAdmin grants', () => {
    beforeAll(async () => {
      const cat = catalog(ctx, SA);
      // Group A: Europe (E1 + acc11, E3 without accounts), China without auctions.
      // Decoys: acc21 (auction E2 not allowed), U1 + accU1 (group America not allowed).
      await cat.grantGroup(gA.id, 'auction-group', c.EU.id);
      await cat.grantGroup(gA.id, 'auction-group', c.CN.id);
      await cat.grantGroup(gA.id, 'auction', c.E1.id);
      await cat.grantGroup(gA.id, 'auction', c.E3.id);
      await cat.grantGroup(gA.id, 'account', c.acc11.id);
      await cat.grantGroup(gA.id, 'account', c.acc21.id);
      await cat.grantGroup(gA.id, 'auction', c.U1.id);
      await cat.grantGroup(gA.id, 'account', c.accU1.id);
      // Group B: Europe with E2 + acc21.
      await cat.grantGroup(gB.id, 'auction-group', c.EU.id);
      await cat.grantGroup(gB.id, 'auction', c.E2.id);
      await cat.grantGroup(gB.id, 'account', c.acc21.id);
      // Blocked group C: full chain.
      const gC = await ctx.prisma.userGroup.findFirstOrThrow({ where: { name: 'Group C (blocked)' } });
      await cat.grantGroup(gC.id, 'auction-group', c.EU.id);
      await cat.grantGroup(gC.id, 'auction', c.E1.id);
      await cat.grantGroup(gC.id, 'account', c.acc11.id);
    });

    it('an enabled auction group does not open its auctions', async () => {
      const groups = await api<any[]>(ctx, uA, 'GET', '/auction-groups');
      const china = groups.data.find((g) => g.title === 'China');
      expect(china).toBeDefined();
      expect(china.auctions).toEqual([]);
      expect((await api(ctx, uA, 'GET', `/auctions/group/${c.CN.id}`)).data).toEqual([]);
      expect((await api(ctx, uA, 'GET', `/auctions/${c.C1.id}`)).status).toBe(404);
      expect((await api(ctx, uA, 'GET', `/auction-auth/${c.C1.id}`)).status).toBe(403);
      expect((await joinAuction(ctx, uA, { auctionId: c.C1.id, auctionAuthId: c.accC1.id })).type).toBe('error');
    });

    it('an enabled auction does not open its accounts', async () => {
      const europe = await api<any[]>(ctx, uA, 'GET', `/auctions/group/${c.EU.id}`);
      expect(titles(europe.data)).toEqual(['E1', 'E3']);
      expect(europe.data.find((a) => a.title === 'E3').auctionAuths).toEqual([]);
      expect((await api(ctx, uA, 'POST', '/auction-auth/select-account', { accountId: c.acc31.id })).status).toBe(403);
      expect((await joinAuction(ctx, uA, { auctionId: c.E3.id, auctionAuthId: c.acc31.id })).type).toBe('error');
    });

    it('an account requires the complete group → auction → account chain', async () => {
      expect(titles((await api<any[]>(ctx, uA, 'GET', `/auction-auth/${c.E1.id}`)).data)).toEqual(['acc11']);
      // account allowed, auction not
      expect((await api(ctx, uA, 'POST', '/auction-auth/select-account', { accountId: c.acc21.id })).status).toBe(403);
      // auction + account allowed, auction group not
      expect((await api(ctx, uA, 'GET', `/auctions/${c.U1.id}`)).status).toBe(404);
      expect((await joinAuction(ctx, uA, { auctionId: c.U1.id, auctionAuthId: c.accU1.id })).type).toBe('error');
      // full chain
      expect((await api(ctx, uA, 'POST', '/auction-auth/select-account', { accountId: c.acc11.id })).status).toBe(201);
      expect((await joinAuction(ctx, uA, { auctionId: c.E1.id, auctionAuthId: c.acc11.id })).type).toBe('ready');
    });

    it('returns account logins (email) only to SuperAdmin', async () => {
      const forUser = await api<any[]>(ctx, uA, 'GET', `/auction-auth/${c.E1.id}`);
      expect(forUser.data[0]).not.toHaveProperty('email');
      expect(forUser.data[0]).not.toHaveProperty('password');
      const forAdmin = await api<any[]>(ctx, adminA, 'GET', `/auctions/group/${c.EU.id}`);
      expect(forAdmin.data.flatMap((a) => a.auctionAuths).every((acc) => !('email' in acc))).toBe(true);
      const forSuperAdmin = await api<any[]>(ctx, SA, 'GET', `/auction-auth/${c.E1.id}`);
      expect(forSuperAdmin.data.every((acc) => typeof acc.email === 'string' && !('password' in acc))).toBe(true);
    });

    it('two groups sharing an auction group only see their own chain', async () => {
      const b = await api<any[]>(ctx, uB, 'GET', `/auctions/group/${c.EU.id}`);
      expect(b.data.map((a) => [a.title, titles(a.auctionAuths)])).toEqual([['E2', ['acc21']]]);
      expect((await api(ctx, uB, 'GET', `/auctions/${c.E1.id}`)).status).toBe(404);
      expect((await api(ctx, uB, 'GET', `/auction-auth/${c.E1.id}`)).status).toBe(403);
      expect((await api(ctx, uB, 'GET', `/sessions/${c.acc11.id}`)).status).toBe(403);
      expect((await api(ctx, uA, 'GET', `/user-groups/${gB.id}`)).status).toBe(404);
    });

    it('a blocked user group has no access at all; a user without a group has none either', async () => {
      expect((await api(ctx, uC, 'GET', '/auction-groups')).data).toEqual([]);
      expect((await api(ctx, uC, 'GET', `/auction-auth/${c.E1.id}`)).status).toBe(403);
      expect((await joinAuction(ctx, uC, { auctionId: c.E1.id, auctionAuthId: c.acc11.id })).type).toBe('error');
      expect((await api(ctx, uNone, 'GET', '/auction-groups')).data).toEqual([]);
    });

    it('protects sessions: no foreign sessionId reattach, no forged userId', async () => {
      const bSession = await joinAuction(ctx, uB, { auctionId: c.E2.id, auctionAuthId: c.acc21.id });
      expect(bSession.type).toBe('ready');
      const sessionId = (bSession as { sessionId: string }).sessionId;

      // Чужий sessionId - лише підказка для відновлення вкладки: користувач отримує сесію свого акаунта.
      const reattach = await joinAuction(ctx, uA, { auctionId: c.E1.id, auctionAuthId: c.acc11.id, sessionId });
      expect(reattach.type).toBe('ready');
      expect((reattach as { sessionId: string }).sessionId).not.toBe(sessionId);
      const forged = await joinAuction(ctx, uA, { auctionId: c.E2.id, auctionAuthId: c.acc21.id, userId: uB.id });
      expect(forged.type).toBe('error');

      const connections = await ctx.prisma.sessionConnection.findMany({ where: { sessionId }, select: { userId: true } });
      expect(connections.map((c) => c.userId)).toEqual([uB.id]);
    });

    it('SuperAdmin still sees the complete catalog and can use any account', async () => {
      expect(titles((await api<any[]>(ctx, SA, 'GET', '/auction-groups')).data)).toEqual(['America', 'China', 'Europe']);
      const europe = await api<any[]>(ctx, SA, 'GET', `/auctions/group/${c.EU.id}`);
      expect(europe.data.flatMap((a) => titles(a.auctionAuths)).sort()).toEqual(['acc11', 'acc12', 'acc21', 'acc31']);
      expect((await joinAuction(ctx, SA, { auctionId: c.C1.id, auctionAuthId: c.accC1.id })).type).toBe('ready');
    });

    it('Admin (GA) is restricted to their own user group', async () => {
      expect(titles((await api<any[]>(ctx, adminA, 'GET', '/auction-groups')).data)).toEqual(['China', 'Europe']);
      expect((await api(ctx, adminA, 'GET', `/auctions/${c.E2.id}`)).status).toBe(404);
      expect((await api<any[]>(ctx, adminA, 'GET', '/user-groups')).data.map((g) => g.id)).toEqual([gA.id]);
      expect((await api(ctx, adminA, 'POST', `/user-groups/${gA.id}/add-auction`, { auctionId: c.E2.id })).status).toBe(403);
      expect((await api(ctx, adminA, 'POST', '/auction-groups', { title: 'X' })).status).toBe(403);
      expect((await api(ctx, adminA, 'GET', `/users/${uB.id}`)).status).toBe(403);
      expect((await api(ctx, adminA, 'GET', `/user-groups/users/${gB.id}`)).status).toBe(403);
      expect((await api(ctx, adminA, 'GET', `/auctions/${c.E2.id}/forbidden-paths`)).status).toBe(403);
    });
  });
});
