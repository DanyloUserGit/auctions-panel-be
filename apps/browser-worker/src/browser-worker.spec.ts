import { existsSync } from 'fs';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { of } from 'rxjs';
import { AuthStrategyRegistry } from './auth/auth.registry';
import { BrowserService } from './browser-worker.service';
import { matchForbiddenUrl } from './rules/page-rules';

// Перевірка воркера на справжньому Chromium (Playwright) і локальній тестовій сторінці.
// Потрібен встановлений браузер: npx playwright install chromium.

const PAGE = `<!doctype html><html><body>
  <button id="buy">Buy now</button>
  <button id="bid-btn" aria-label="Place bid">Bid</button>
  <a id="forbidden-link" href="/orders/1">Orders</a>
  <a id="blank" href="/ok" target="_blank">Open in new tab</a>
  <button id="spa" onclick="history.pushState(null, '', '/orders/2')">SPA</button>
  <button id="popup" onclick="window.open('/ok?popup=1')">Popup</button>
  <input id="bid" name="bid" />
  <input id="secret" type="password" />
</body></html>`;

describe('matchForbiddenUrl', () => {
  const url = 'https://carmarket.ayvens.com/en-es/_orders/123?x=1';
  it.each([
    ['https://carmarket.ayvens.com/en-es/_orders/', true],
    ['https://carmarket.ayvens.com/en-es/_orders', true],
    ['https://carmarket.ayvens.com/en-es/_order', false],
    ['/_orders/', true],
    ['_orders', true],
    ['/cart/', false],
    ['*/_orders/*', true],
    ['https://carmarket.ayvens.com/*/_orders/*', true],
    ['https://other.com/en-es/_orders/', false],
    ['/', false],
    ['', false],
  ])('%s -> %s', (pattern, expected) => {
    expect(matchForbiddenUrl(url, pattern)).toBe(expected);
  });
});

describe('BrowserService (Chromium)', () => {
  let server: Server;
  let base: string;
  let service: BrowserService;
  const emitted: { pattern: string; data: any }[] = [];
  const sessionId = `spec-${Date.now()}`;

  const logs = (userId?: string) =>
    emitted.filter((e) => e.pattern === 'session.log.event' && (!userId || e.data.userId === userId)).map((e) => e.data);
  const pageOf = (clientId: string) => (service as any).pages.get(`${sessionId}_${clientId}`).page;
  const settle = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(req.url === '/' ? PAGE : `<html><body>${req.url}</body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const apiClient = { emit: (pattern: string, data: any) => (emitted.push({ pattern, data }), of(undefined)) };
    // Автологін вводить логін акаунта в поле: це не повинно потрапити в журнал (секрет для GA/User).
    const registry = new AuthStrategyRegistry();
    registry.register({
      url: `${base}/`,
      login: async (page) => {
        await page.fill('#bid', 'login@test');
        await page.click('body');
        await page.waitForTimeout(200);
      },
    });
    service = new BrowserService(registry, apiClient as any);
    await service.launchSession(sessionId, `${base}/`, { width: 800, height: 600 }, { email: 'login@test', password: 'secret' });
    await service.addClientPage('user-1', sessionId, 'c1', { forbiddenRoutes: ['/orders/'], forbiddenSelectors: ['#buy'] }, () => undefined);
    await service.addClientPage('user-2', sessionId, 'c2', { forbiddenRoutes: [], forbiddenSelectors: [] }, () => undefined);
  }, 60000);

  afterAll(async () => {
    await service?.stopSession(sessionId);
    server?.close();
  });

  it('does not log what the autologin types (account login)', async () => {
    for (let i = 0; i < 50 && !logs().some((l) => l.message === 'Автологін завершено'); i++) await settle();
    expect(logs()).toContainEqual(expect.objectContaining({ message: 'Автологін завершено' }));
    expect(JSON.stringify(logs())).not.toContain('login@test');
  });

  it('blocks a forbidden element for this user and logs it as a forbidden action', async () => {
    await pageOf('c1').click('#buy');
    await settle();
    expect(logs('user-1')).toContainEqual(expect.objectContaining({ eventType: 'ForbiddenAction', isIncident: true, message: expect.stringContaining('#buy') }));
  });

  it('another user of the same session has own rules', async () => {
    await pageOf('c2').click('#buy');
    await settle();
    expect(logs('user-2').some((l) => l.eventType === 'ForbiddenAction')).toBe(false);
    expect(logs('user-2')).toContainEqual(expect.objectContaining({ eventType: 'ButtonClick', message: expect.stringContaining('#buy') }));
  });

  it('logs button clicks with the element identifier and text input with the value (no passwords)', async () => {
    const page = pageOf('c1');
    await page.click('#bid-btn');
    await page.fill('#bid', '1500');
    await page.fill('#secret', 'top-secret');
    await page.click('body');
    await settle();
    const own = logs('user-1');
    expect(own).toContainEqual(expect.objectContaining({ eventType: 'ButtonClick', message: expect.stringMatching(/#bid-btn.*Place bid/) }));
    expect(own).toContainEqual(expect.objectContaining({ eventType: 'TextInput', message: expect.stringContaining('"1500"') }));
    expect(JSON.stringify(own)).not.toContain('top-secret');
  });

  it('blocks forbidden links and History API navigation', async () => {
    const page = pageOf('c1');
    await page.click('#forbidden-link');
    await page.click('#spa');
    await settle();
    expect(page.url()).toBe(`${base}/`);
    expect(logs('user-1').filter((l) => l.eventType === 'ForbiddenAction' && l.message.includes('/orders/')).length).toBeGreaterThanOrEqual(2);
  });

  it('opens «new tab» links and window.open in the same tab of this user only', async () => {
    const page = pageOf('c1');
    await page.click('#blank');
    await page.waitForURL(`${base}/ok`);
    expect(logs('user-1')).toContainEqual(expect.objectContaining({ eventType: 'Navigation', message: expect.stringContaining('/ok') }));
    expect(pageOf('c2').url()).toBe(`${base}/`);

    await page.goBack();
    await page.click('#popup');
    await page.waitForURL(`${base}/ok?popup=1`);
    expect(pageOf('c2').url()).toBe(`${base}/`);
  });

  it('blocks direct navigation to a forbidden URL on the network level', async () => {
    await pageOf('c1').goto(`${base}/orders/7`).catch(() => undefined);
    await settle();
    expect(logs('user-1')).toContainEqual(expect.objectContaining({ eventType: 'ForbiddenAction', message: expect.stringContaining('/orders/7') }));
  });

  it('ignores the right mouse button and reports activity', async () => {
    await service.interact(sessionId, 'c2', { type: 'mousedown', x: 10, y: 10, button: 2 });
    await service.interact(sessionId, 'c2', { type: 'text', text: 'abc' });
    await settle();
    expect(emitted.some((e) => e.pattern === 'session.activity' && e.data.userId === 'user-2')).toBe(true);
  });

  it('with an allowed-pages list only those pages (and the home page) open', async () => {
    await service.addClientPage('user-3', sessionId, 'c3', { forbiddenRoutes: [], forbiddenSelectors: [], allowedRoutes: ['/ok'] }, () => undefined);
    const page = pageOf('c3');
    await page.goto(`${base}/other`).catch(() => undefined);
    await settle();
    expect(page.url()).not.toBe(`${base}/other`);
    expect(logs('user-3')).toContainEqual(expect.objectContaining({ eventType: 'ForbiddenAction', message: expect.stringContaining('поза списком дозволених') }));
    await page.goto(`${base}/ok`);
    expect(page.url()).toBe(`${base}/ok`);
    await page.goto(`${base}/`);
    expect(page.url()).toBe(`${base}/`);
  });

  it('stopping the session removes the browser profile', async () => {
    const dir = path.join(os.tmpdir(), 'playwright_sessions', sessionId);
    expect(existsSync(dir)).toBe(true);
    await service.stopSession(sessionId);
    expect(existsSync(dir)).toBe(false);
    expect(emitted.some((e) => e.pattern === 'session.failed')).toBe(false);
  });
});
