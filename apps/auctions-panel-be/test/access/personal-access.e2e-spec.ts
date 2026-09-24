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

describe('Personal access, GA account denials, favourites, showAccounts', () => {
  let ctx: TestContext;
  let SA: TestUser, admin: TestUser, u1: TestUser, u2: TestUser, uBlocked: TestUser, uOther: TestUser;
  let group: { id: string };
  const c: Record<string, { id: string }> = {};
  let cat: ReturnType<typeof catalog>;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);

    SA = await createUser(ctx, 'superadmin', Roles.SuperAdmin);
    admin = await createUser(ctx, 'admin', Roles.Admin);
    group = await ctx.prisma.userGroup.create({ data: { name: 'Group P', AdminId: admin.id } });
    const blocked = await ctx.prisma.userGroup.create({ data: { name: 'Blocked', isActive: false } });
    const other = await ctx.prisma.userGroup.create({ data: { name: 'Other' } });
    u1 = await createUser(ctx, 'user-1', Roles.User, { userGroupId: group.id });
    u2 = await createUser(ctx, 'user-2', Roles.User, { userGroupId: group.id });
    uBlocked = await createUser(ctx, 'user-blocked', Roles.User, { userGroupId: blocked.id });
    uOther = await createUser(ctx, 'user-other', Roles.User, { userGroupId: other.id });

    cat = catalog(ctx, SA);
    c.K = await cat.auctionGroup('K');
    c.K1 = await cat.auction('K1', c.K.id);
    c.K2 = await cat.auction('K2', c.K.id);
    c.k11 = await cat.account('k11', c.K1.id);
    c.k12 = await cat.account('k12', c.K1.id);
    c.k21 = await cat.account('k21', c.K2.id);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('a personal chain gives access only to that user', async () => {
    await cat.grantUser(u1.id, 'auction-group', c.K.id);
    await cat.grantUser(u1.id, 'auction', c.K1.id);
    await cat.grantUser(u1.id, 'account', c.k11.id);

    const own = await api<any[]>(ctx, u1, 'GET', `/auctions/group/${c.K.id}`);
    expect(own.data.map((a) => [a.title, titles(a.auctionAuths)])).toEqual([['K1', ['k11']]]);
    expect((await api(ctx, u2, 'GET', `/auctions/group/${c.K.id}`)).data).toEqual([]);
    expect((await joinAuction(ctx, u2, { auctionId: c.K1.id, auctionAuthId: c.k11.id })).type).toBe('error');
  });

  it('personal grants still need every level: an account without its auction does nothing', async () => {
    await cat.grantUser(u1.id, 'account', c.k21.id);
    expect((await api(ctx, u1, 'POST', '/auction-auth/select-account', { accountId: c.k21.id })).status).toBe(403);
  });

  it('group and personal grants combine level by level', async () => {
    await cat.grantGroup(group.id, 'auction-group', c.K.id);
    await cat.grantUser(u2.id, 'auction', c.K2.id);
    await cat.grantUser(u2.id, 'account', c.k21.id);
    const res = await api<any[]>(ctx, u2, 'GET', `/auctions/group/${c.K.id}`);
    expect(res.data.map((a) => [a.title, titles(a.auctionAuths)])).toEqual([['K2', ['k21']]]);
    expect((await api(ctx, uOther, 'GET', `/auctions/group/${c.K.id}`)).data).toEqual([]);
  });

  it('a blocked group also blocks personal grants', async () => {
    await cat.grantUser(uBlocked.id, 'auction-group', c.K.id);
    await cat.grantUser(uBlocked.id, 'auction', c.K1.id);
    await cat.grantUser(uBlocked.id, 'account', c.k11.id);
    expect((await api(ctx, uBlocked, 'GET', '/auction-groups')).data).toEqual([]);
  });

  it('only SuperAdmin grants personal access; GA reads it for own members without logins', async () => {
    const view = await api<any>(ctx, admin, 'GET', `/users/${u1.id}/access`);
    expect(view.status).toBe(200);
    expect(view.data.allowedAccounts.every((a: object) => !('email' in a))).toBe(true);
    expect((await api(ctx, admin, 'POST', `/users/${u1.id}/add-account`, { accountId: c.k12.id })).status).toBe(403);
    expect((await api(ctx, admin, 'GET', `/users/${uOther.id}/access`)).status).toBe(403);
    expect((await api(ctx, u1, 'GET', `/users/${u1.id}/access`)).status).toBe(403);
  });

  describe('GA denials (canGaManageAccounts)', () => {
    beforeAll(async () => {
      await cat.grantGroup(group.id, 'auction', c.K1.id);
      await cat.grantGroup(group.id, 'account', c.k12.id);
    });

    it('GA cannot deny while SuperAdmin has not enabled canGaManageAccounts', async () => {
      const res = await api<any>(ctx, admin, 'GET', `/users/${u2.id}/access`);
      expect(res.data.canManageDenials).toBe(false);
      expect((await api(ctx, admin, 'POST', `/users/${u2.id}/deny-account`, { accountId: c.k12.id })).status).toBe(403);
    });

    it('with the flag on, GA removes a group account from one member only', async () => {
      await api(ctx, SA, 'PATCH', `/user-groups/${group.id}`, { canGaManageAccounts: true });
      expect((await api<any>(ctx, admin, 'GET', `/users/${u2.id}/access`)).data.canManageDenials).toBe(true);

      expect((await api(ctx, admin, 'POST', `/users/${u2.id}/deny-account`, { accountId: c.k12.id })).status).toBe(201);
      expect((await api(ctx, u2, 'POST', '/auction-auth/select-account', { accountId: c.k12.id })).status).toBe(403);
      expect((await api(ctx, u1, 'POST', '/auction-auth/select-account', { accountId: c.k12.id })).status).toBe(201);

      expect((await api(ctx, admin, 'DELETE', `/users/${u2.id}/deny-account`, { accountId: c.k12.id })).status).toBe(200);
      expect((await api(ctx, u2, 'POST', '/auction-auth/select-account', { accountId: c.k12.id })).status).toBe(201);
    });

    it('only accounts granted to the group can be denied; GA cannot touch other groups', async () => {
      expect((await api(ctx, admin, 'POST', `/users/${u2.id}/deny-account`, { accountId: c.k11.id })).status).toBe(400);
      expect((await api(ctx, admin, 'POST', `/users/${uOther.id}/deny-account`, { accountId: c.k12.id })).status).toBe(403);
    });

    it('GA cannot change the flag itself', async () => {
      await api(ctx, admin, 'PATCH', `/user-groups/${group.id}`, { canGaManageAccounts: false, showAccounts: false });
      const g = await ctx.prisma.userGroup.findUniqueOrThrow({ where: { id: group.id } });
      expect(g.canGaManageAccounts).toBe(true);
      expect(g.showAccounts).toBe(true);
    });
  });

  it('favourites are per user: two users can select the same account', async () => {
    await api(ctx, u1, 'POST', '/auction-auth/select-account', { accountId: c.k12.id });
    await api(ctx, u2, 'POST', '/auction-auth/select-account', { accountId: c.k12.id });
    expect(titles((await api<any[]>(ctx, u1, 'GET', '/auction-auth/selected')).data)).toContain('k12');
    expect(titles((await api<any[]>(ctx, u2, 'GET', '/auction-auth/selected')).data)).toContain('k12');
  });

  describe('showAccounts = false', () => {
    beforeAll(async () => {
      await api(ctx, SA, 'PATCH', `/user-groups/${group.id}`, { showAccounts: false });
    });

    it('members cannot start new sessions and see only accounts with a running session', async () => {
      expect((await api(ctx, u2, 'GET', `/auction-auth/${c.K1.id}`)).data).toEqual([]);
      const start = await joinAuction(ctx, u2, { auctionId: c.K1.id, auctionAuthId: c.k12.id });
      expect(start.type).toBe('error');

      // GA (not hidden) starts the session; the member can then see and join it.
      const running = await joinAuction(ctx, admin, { auctionId: c.K1.id, auctionAuthId: c.k12.id });
      expect(running.type).toBe('ready');
      expect(titles((await api<any[]>(ctx, u2, 'GET', `/auction-auth/${c.K1.id}`)).data)).toEqual(['k12']);
      const join = await joinAuction(ctx, u2, { auctionId: c.K1.id, auctionAuthId: c.k12.id });
      expect(join).toEqual(running);
    });
  });
});
