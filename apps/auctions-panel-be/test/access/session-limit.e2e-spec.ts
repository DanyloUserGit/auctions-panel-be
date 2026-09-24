import { Roles } from '@prisma/client';
import {
  api,
  burstJoin,
  catalog,
  createTestApp,
  createUser,
  joinAuction,
  resetDatabase,
  TestContext,
  TestUser,
} from './helpers';

// AuctionGroup.sessionLimit: max simultaneously active sessions across the group's auctions (0 = unlimited).
describe('Auction group session limit', () => {
  let ctx: TestContext;
  let SA: TestUser;
  let cat: ReturnType<typeof catalog>;

  const activeInGroup = (auctionGroupId: string) =>
    ctx.prisma.session.count({ where: { isActive: true, auction: { auctionGroupId } } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    SA = await createUser(ctx, 'superadmin', Roles.SuperAdmin);
    cat = catalog(ctx, SA);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('rejects a new session above the limit, but joining a running session is not counted', async () => {
    const group = await cat.auctionGroup('Limit 1', 1);
    const auction = await cat.auction('L1', group.id);
    const a1 = await cat.account('l1-a', auction.id);
    const a2 = await cat.account('l1-b', auction.id);

    const first = await joinAuction(ctx, SA, { auctionId: auction.id, auctionAuthId: a1.id });
    expect(first.type).toBe('ready');

    const second = await joinAuction(ctx, SA, { auctionId: auction.id, auctionAuthId: a2.id });
    expect(second).toEqual({ type: 'error', message: expect.stringMatching(/ліміт/i) });

    const joinRunning = await joinAuction(ctx, SA, { auctionId: auction.id, auctionAuthId: a1.id });
    expect(joinRunning).toEqual(first);

    const card = await api<any>(ctx, SA, 'GET', `/auction-groups/${group.id}`);
    expect(card.data.sessionsCount).toBe(1);
  });

  it('a cleared limit (0) is unlimited', async () => {
    const group = await cat.auctionGroup('Cleared', 1);
    const auction = await cat.auction('CL', group.id);
    const accounts = await Promise.all(['cl-a', 'cl-b', 'cl-c'].map((t) => cat.account(t, auction.id)));

    const patch = await api<any>(ctx, SA, 'PATCH', `/auction-groups/${group.id}`, { title: 'Cleared', sessionLimit: 0 });
    expect(patch.data.sessionLimit).toBe(0);

    const results = await burstJoin(ctx, SA, accounts.map((a) => ({ auctionId: auction.id, auctionAuthId: a.id })));
    expect(results.every((r) => r.type === 'ready')).toBe(true);
  });

  it('concurrent starts never exceed the limit', async () => {
    const group = await cat.auctionGroup('Limit 2', 2);
    const auction = await cat.auction('L2', group.id);
    const accounts = [];
    for (let i = 0; i < 8; i++) accounts.push(await cat.account(`l2-${i}`, auction.id));

    for (let round = 0; round < 3; round++) {
      const results = await burstJoin(ctx, SA, accounts.map((a) => ({ auctionId: auction.id, auctionAuthId: a.id })));
      expect(results.filter((r) => r.type === 'ready')).toHaveLength(2);
      expect(results.filter((r) => r.type === 'error' && /ліміт/i.test(r.message))).toHaveLength(6);
      expect(await activeInGroup(group.id)).toBe(2);
      await ctx.prisma.session.updateMany({ where: { auction: { auctionGroupId: group.id } }, data: { isActive: false, activeConnections: 0 } });
    }
  });

  it('concurrent starts of the same account share one session', async () => {
    const group = await cat.auctionGroup('Shared', 1);
    const auction = await cat.auction('SH', group.id);
    const account = await cat.account('sh-a', auction.id);

    const results = await burstJoin(ctx, SA, Array.from({ length: 5 }, () => ({ auctionId: auction.id, auctionAuthId: account.id })));
    expect(results.every((r) => r.type === 'ready')).toBe(true);
    expect(new Set(results.map((r) => (r as { sessionId: string }).sessionId)).size).toBe(1);
    expect(await activeInGroup(group.id)).toBe(1);
  });
});
