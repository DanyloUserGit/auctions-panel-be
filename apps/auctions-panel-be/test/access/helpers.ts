import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Roles } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AddressInfo } from 'net';
import { io } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

// Access-model e2e tests run against a real, migrated PostgreSQL and truncate ALL tables.
// They refuse to start unless TEST_DATABASE_URL points to a database whose name contains "test".
export function requireTestDatabase(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set - see "Access e2e tests" in the backend README.');
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run: database "${dbName}" must contain "test" in its name (tests truncate all tables).`);
  }
  return url;
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  baseUrl: string;
  jwt: JwtService;
}

export type TestUser = { id: string; email: string; role: Roles };

// Minimal shapes of catalog entities returned by the API.
export type Entity = { id: string; title: string; sessionLimit?: number };

export async function createTestApp(): Promise<TestContext> {
  requireTestDatabase();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  // Same HTTP setup as main.ts.
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.listen(0);

  const server = app.getHttpServer() as { address(): AddressInfo };
  const { port } = server.address();
  return {
    app,
    prisma: app.get(PrismaService),
    baseUrl: `http://127.0.0.1:${port}`,
    jwt: new JwtService({ secret: process.env.JWT_SECRET }),
  };
}

export async function resetDatabase(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

// Same payload as AuthService.login signs (the Turnstile-protected login itself is not exercised here).
const tokenFor = (ctx: TestContext, user: TestUser) =>
  ctx.jwt.sign({ id: user.id, email: user.email, role: user.role }, { expiresIn: '15m' });

export async function api<T = unknown>(
  ctx: TestContext,
  user: TestUser,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${ctx.baseUrl}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `access_token=${tokenFor(ctx, user)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

export type JoinResult = { type: 'ready'; sessionId: string } | { type: 'error'; message: string } | { type: 'timeout' };

export type JoinPayload = { auctionId: string; auctionAuthId: string; sessionId?: string; userId?: string };

function connect(ctx: TestContext, user: TestUser) {
  return new Promise<ReturnType<typeof io>>((resolve, reject) => {
    const socket = io(ctx.baseUrl, {
      transports: ['websocket'],
      extraHeaders: { Cookie: `access_token=${tokenFor(ctx, user)}` },
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emitJoin(socket: ReturnType<typeof io>, payload: JoinPayload): Promise<JoinResult> {
  return new Promise((resolve) => {
    const done = (result: JoinResult) => {
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => done({ type: 'timeout' }), 20000);
    socket.on('session_ready', (d: { sessionId: string }) => done({ type: 'ready', sessionId: d.sessionId }));
    socket.on('error', (e: { message?: string }) => done({ type: 'error', message: e?.message ?? 'unknown error' }));
    socket.emit('join_auction', { width: 800, height: 600, ...payload });
  });
}

export async function joinAuction(ctx: TestContext, user: TestUser, payload: JoinPayload) {
  return emitJoin(await connect(ctx, user), payload);
}

// Connects all sockets first, then emits every join at once to maximise overlap.
export async function burstJoin(ctx: TestContext, user: TestUser, payloads: JoinPayload[]) {
  const sockets = await Promise.all(payloads.map(() => connect(ctx, user)));
  return Promise.all(sockets.map((socket, i) => emitJoin(socket, payloads[i])));
}

export async function createUser(ctx: TestContext, key: string, role: Roles, extra: { userGroupId?: string } = {}) {
  return ctx.prisma.user.create({
    data: { firstName: key, lastName: 'E2E', email: `${key}@e2e-test.invalid`, password: 'not-used', role, ...extra },
    select: { id: true, email: true, role: true },
  });
}

// Catalog helpers - created through the SuperAdmin API, exactly as in production.
export function catalog(ctx: TestContext, superAdmin: TestUser) {
  return {
    auctionGroup: async (title: string, sessionLimit?: number) =>
      (await api<Entity>(ctx, superAdmin, 'POST', '/auction-groups', { title, ...(sessionLimit !== undefined && { sessionLimit }) })).data,
    auction: async (title: string, auctionGroupId: string) =>
      (await api<Entity>(ctx, superAdmin, 'POST', '/auctions', { title, url: `https://${title.toLowerCase()}.e2e-test.invalid/`, auctionGroupId })).data,
    account: async (title: string, auctionId: string) =>
      (await api<Entity>(ctx, superAdmin, 'POST', '/auction-auth', { title, email: `${title}@e2e-test.invalid`, password: 'secret-123', auctionId })).data,
    grantGroup: async (userGroupId: string, kind: 'auction-group' | 'auction' | 'account', id: string) => {
      const field = kind === 'auction-group' ? 'auctionGroupId' : kind === 'auction' ? 'auctionId' : 'accountId';
      const res = await api(ctx, superAdmin, 'POST', `/user-groups/${userGroupId}/add-${kind}`, { [field]: id });
      if (res.status !== 201) throw new Error(`grant ${kind} failed: ${res.status}`);
    },
    grantUser: async (userId: string, kind: 'auction-group' | 'auction' | 'account', id: string) => {
      const field = kind === 'auction-group' ? 'auctionGroupId' : kind === 'auction' ? 'auctionId' : 'accountId';
      const res = await api(ctx, superAdmin, 'POST', `/users/${userId}/add-${kind}`, { [field]: id });
      if (res.status !== 201) throw new Error(`personal grant ${kind} failed: ${res.status}`);
    },
  };
}

export const titles = (items: { title: string }[] | undefined) => (items ?? []).map((i) => i.title).sort();
