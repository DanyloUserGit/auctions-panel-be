import { Roles } from '@prisma/client';
import { api, createTestApp, createUser, resetDatabase, TestContext, TestUser } from './helpers';
import { ExternalDbManager } from '../../src/client-db/client-db.service';

// CRM-модулі (ТЗ 13, 19): кожен бачить лише записи в межах своєї ролі; SQL будується лише з відомих колонок.
describe('CRM modules: scope and safety', () => {
  let ctx: TestContext;
  let SA: TestUser;
  let GA: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    SA = await createUser(ctx, 'crm-sa', Roles.SuperAdmin);
    GA = await createUser(ctx, 'crm-ga', Roles.Admin);
    const group = await ctx.prisma.userGroup.create({ data: { name: 'CRM group', AdminId: GA.id } });
    member = await createUser(ctx, 'crm-member', Roles.User, { userGroupId: group.id });
    outsider = await createUser(ctx, 'crm-outsider', Roles.User);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  describe('Orders', () => {
    let memberOrderId: number;

    it('creates an order owned by the caller; unknown keys never reach SQL', async () => {
      const res = await api<any>(ctx, member, 'POST', '/orders', {
        first_name: 'Ivan',
        brand_names: 'BMW',
        price_from: 1000,
        'id) VALUES (1); DROP TABLE car_orders; --': 'x',
        user: outsider.id,
      });
      expect(res.status).toBe(201);
      expect(res.data.user).toBe(member.id);
      expect(res.data.first_name).toBe('Ivan');
      memberOrderId = res.data.id;
    });

    it('rejects invalid values with 400, not 500', async () => {
      const res = await api(ctx, member, 'POST', '/orders', { price_from: 'not-a-number' });
      expect(res.status).toBe(400);
    });

    it('other users cannot read, change or delete it', async () => {
      expect((await api(ctx, outsider, 'GET', `/orders/${memberOrderId}`)).status).toBe(404);
      expect((await api(ctx, outsider, 'PATCH', `/orders/${memberOrderId}`, { first_name: 'Hacked' })).status).toBe(404);
      expect((await api(ctx, outsider, 'DELETE', `/orders/${memberOrderId}`)).status).toBe(404);
      const list = await api<any[]>(ctx, outsider, 'GET', '/orders');
      expect(list.data.map((o) => o.id)).not.toContain(memberOrderId);
    });

    it('owner cannot reassign the order via the user field', async () => {
      const res = await api<any>(ctx, member, 'PATCH', `/orders/${memberOrderId}`, { user: outsider.id, last_name: 'Petrenko' });
      expect(res.status).toBe(200);
      expect(res.data.user).toBe(member.id);
      expect(res.data.last_name).toBe('Petrenko');
    });

    it('GA sees orders of the group, SuperAdmin sees all', async () => {
      const outsiderOrder = await api<any>(ctx, outsider, 'POST', '/orders', { first_name: 'Other' });
      const gaList = await api<any[]>(ctx, GA, 'GET', '/orders');
      expect(gaList.data.map((o) => o.id)).toContain(memberOrderId);
      expect(gaList.data.map((o) => o.id)).not.toContain(outsiderOrder.data.id);

      const saList = await api<any[]>(ctx, SA, 'GET', '/orders');
      expect(saList.data.map((o) => o.id)).toEqual(expect.arrayContaining([memberOrderId, outsiderOrder.data.id]));
    });

    it('the client cannot choose another database', async () => {
      const res = await fetch(`${ctx.baseUrl}/api/orders`, { headers: { 'x-client-db': 'mysql' } });
      expect(res.status).toBe(401);
      const own = await api<any[]>(ctx, member, 'GET', '/orders');
      expect(own.status).toBe(200);
    });

    it('owner deletes the order', async () => {
      expect((await api(ctx, member, 'DELETE', `/orders/${memberOrderId}`)).status).toBe(200);
      expect((await api(ctx, member, 'GET', `/orders/${memberOrderId}`)).status).toBe(404);
    });
  });

  describe('Processes and balances', () => {
    const MEMBER_CLIENT = 'E2E Client Member';
    const OTHER_CLIENT = 'E2E Client Other';

    beforeAll(async () => {
      const db = await ctx.app.get(ExternalDbManager).getConnection('table_extourcars1');
      await db.query("DELETE FROM cars_data WHERE zamovnyk LIKE 'E2E Client%'");
      await db.query("DELETE FROM transport_payments WHERE zamovnyk LIKE 'E2E Client%'");
      for (const client of [MEMBER_CLIENT, OTHER_CLIENT]) {
        await db.query('INSERT INTO cars_data (zamovnyk, marka_model, numer_vin) VALUES (?, ?, ?)', [client, 'Bmw X5', `VIN-${client}`]);
        await db.query(
          "INSERT INTO transport_payments (numer_rej, marka_model, numer_vin, zamovnyk, driver, to_pay_eur, extra_notes, transport_date) VALUES ('AA', 'Bmw X5', ?, ?, 'D', 100, 'привезли', '2026-01-01')",
          [`VIN-${client}`, client],
        );
      }
    });

    const processClients = async (user: TestUser) =>
      (await api<any>(ctx, user, 'GET', '/processes')).data.data.map((r: any) => r.zamovnyk).filter((c: string) => c.startsWith('E2E'));
    const balanceClients = async (user: TestUser) =>
      (await api<any[]>(ctx, user, 'GET', '/balance/data?client=ALL')).data.map((c) => c.clientName).filter((c: string) => c.startsWith('E2E'));

    it('users without assigned clients see nothing', async () => {
      expect(await processClients(member)).toEqual([]);
      expect(await balanceClients(member)).toEqual([]);
      expect((await api<string[]>(ctx, member, 'GET', '/balance/clients')).data).toEqual([]);
    });

    it('only SuperAdmin assigns clients', async () => {
      expect((await api(ctx, GA, 'PUT', '/crm-clients/assignment', { clientName: MEMBER_CLIENT, userIds: [GA.id] })).status).toBe(403);
      const res = await api(ctx, SA, 'PUT', '/crm-clients/assignment', { clientName: MEMBER_CLIENT, userIds: [member.id] });
      expect(res.status).toBe(200);
      const list = await api<any[]>(ctx, SA, 'GET', '/crm-clients');
      expect(list.data.find((c) => c.clientName === MEMBER_CLIENT).users.map((u: any) => u.id)).toEqual([member.id]);
    });

    it('User sees own clients, GA - clients of the group, SuperAdmin - all', async () => {
      expect(await processClients(member)).toEqual([MEMBER_CLIENT]);
      expect(await balanceClients(member)).toEqual([MEMBER_CLIENT]);
      expect(await processClients(outsider)).toEqual([]);
      expect(await processClients(GA)).toEqual([MEMBER_CLIENT]);
      expect((await processClients(SA)).sort()).toEqual([MEMBER_CLIENT, OTHER_CLIENT]);
    });

    it('С-9: GA and SA change process stages within their clients; users cannot', async () => {
      const own = (await api<any>(ctx, GA, 'GET', '/processes')).data.data.find((r: any) => r.zamovnyk === MEMBER_CLIENT);
      const foreign = (await api<any>(ctx, SA, 'GET', '/processes')).data.data.find((r: any) => r.zamovnyk === OTHER_CLIENT);

      const set = (user: TestUser, id: number, body: unknown) => api<any>(ctx, user, 'PATCH', `/processes/${id}`, body);
      expect((await set(member, own.id, { field: 'data_oplaty', date: '2026-09-01' })).status).toBe(403);
      expect((await set(GA, foreign.id, { field: 'data_oplaty', date: '2026-09-01' })).status).toBe(403);
      expect((await set(GA, own.id, { field: 'zamovnyk', date: '2026-09-01' })).status).toBe(400);
      expect((await set(GA, own.id, { field: 'data_oplaty', date: '2026-09-01' })).status).toBe(200);

      const after = (await api<any>(ctx, GA, 'GET', '/processes?open=false')).data.data.find((r: any) => r.id === own.id);
      expect(after.statuses.doneOplata).toBe(true);
      expect((await set(SA, own.id, { field: 'data_oplaty', date: null })).status).toBe(200);
    });

    it('a user cannot request a balance of a foreign client', async () => {
      const res = await api<any[]>(ctx, member, 'GET', `/balance/data?client=${encodeURIComponent(OTHER_CLIENT)}`);
      expect(res.data).toEqual([]);
    });
  });

  describe('В-14: purchases', () => {
    let carId: number;
    let seller: TestUser;

    beforeAll(async () => {
      seller = await createUser(ctx, 'purchase-seller', Roles.User, { userGroupId: (await ctx.prisma.user.findUniqueOrThrow({ where: { id: member.id } })).userGroupId! });
      await ctx.prisma.user.update({ where: { id: seller.id }, data: { accessStatus: 'PurchaseSale' } });
      const db = await ctx.app.get(ExternalDbManager).getConnection('caddylc2_caddycombca');
      const legacy = (email: string) =>
        db.query(
          "INSERT INTO users (email, password, verifycode, firstname, middlename, surname, phone, city, address, passport, idcode, reg_date, status) VALUES (?, '', '', 'L', '', 'U', '', '', '', '', '', 0, 1)",
          [email.toUpperCase()],
        );
      const [res]: any = await legacy(seller.email);
      const [car]: any = await db.query(
        "INSERT INTO cars (auction_id, brand_id, model_id, price, status, won_user_id, chassis, mileage, first_on_road, photos) VALUES (1, 28, (SELECT id FROM models WHERE brand_id = 28 LIMIT 1), 9000, 2, ?, 'WBA8E9G50GNU00001', 120000, 1546300800, 'https://example.com/a.jpg,https://example.com/b.jpg')",
        [res.insertId],
      );
      carId = car.insertId;
    });

    const ids = async (user: TestUser) => (await api<any>(ctx, user, 'GET', '/purchases')).data.cars.map((c: any) => c.id);

    it('buyer (matched by email) sees the purchase; GA of the group too; others do not', async () => {
      expect(await ids(seller)).toContain(carId);
      expect(await ids(GA)).toContain(carId);
      expect(await ids(outsider)).not.toContain(carId);
      expect(await ids(SA)).toContain(carId);
    });

    it('the buyer puts the purchase on sale once; others cannot', async () => {
      const source = await api<any>(ctx, seller, 'GET', `/purchases/${carId}`);
      expect(source.data).toMatchObject({ brandId: 28, chassis: 'WBA8E9G50GNU00001', photos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] });
      expect((await api(ctx, outsider, 'GET', `/purchases/${carId}`)).status).toBe(404);

      const payload = { ...source.data, year: 2019, price: 15000, sourcePurchaseId: carId };
      const listed = await api<any>(ctx, seller, 'POST', '/in-stock', payload);
      expect(listed.status).toBe(201);
      expect(listed.data.owner.id).toBe(seller.id);
      expect((await api(ctx, seller, 'POST', '/in-stock', payload)).status).toBe(409);
      expect((await api(ctx, SA, 'POST', '/in-stock', { ...payload, chassis: 'WBA8E9G50GNU00002' })).status).toBe(409);
    });
  });

  describe('С-8: sold cars CSV import', () => {
    const upload = (user: TestUser, csv: string, updateExisting = false) => {
      const form = new FormData();
      form.append('file', new Blob([csv], { type: 'text/csv' }), 'sold.csv');
      form.append('updateExisting', String(updateExisting));
      const token = ctx.jwt.sign({ id: user.id, email: user.email, role: user.role });
      return fetch(`${ctx.baseUrl}/api/calc/sold-import`, { method: 'POST', body: form, headers: { Cookie: `access_token=${token}` } });
    };

    beforeAll(async () => {
      // Тригер sold_car_prices із дампа замовника має DEFINER-користувача, якого немає в тестовій MariaDB.
      const db = await ctx.app.get(ExternalDbManager).getConnection('table_extourcars1');
      await db.query("CREATE USER IF NOT EXISTS 'tmp_f1af63e19164'@'localhost'");
      await db.query("GRANT ALL ON *.* TO 'tmp_f1af63e19164'@'localhost'");
    });

    it('admins import CSV; users cannot', async () => {
      const csv = ['country;brand;model;sale_price;sale_date', `PL;E2EBrand;E2EModel-${Date.now()};12500;2026-05-01`, ''].join('\n');
      expect((await upload(member, csv)).status).toBe(403);
      const res = await upload(SA, csv);
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ ok: true, inserted: 1 });
      const bad = await upload(SA, ['foo;bar', '1;2', ''].join('\n'));
      expect(bad.status).toBe(400);
    });
  });

  describe('С-15: clients', () => {
    it('each user keeps own clients; GA sees the group; SA sees all', async () => {
      const mine = await api<any>(ctx, member, 'POST', '/clients', { fullName: 'Петро Клієнт', phone: '+380501112233', lookingFor: 'Bmw X5 2019', stage: 'Searching' });
      expect(mine.status).toBe(201);
      const foreign = await api<any>(ctx, outsider, 'POST', '/clients', { fullName: 'Чужий Клієнт' });

      const names = async (user: TestUser) => (await api<any[]>(ctx, user, 'GET', '/clients')).data.map((c) => c.fullName);
      expect(await names(member)).toEqual(['Петро Клієнт']);
      expect(await names(GA)).toContain('Петро Клієнт');
      expect(await names(GA)).not.toContain('Чужий Клієнт');
      expect(await names(SA)).toEqual(expect.arrayContaining(['Петро Клієнт', 'Чужий Клієнт']));

      expect((await api(ctx, member, 'PATCH', `/clients/${foreign.data.id}`, { stage: 'Closed' })).status).toBe(404);
      expect((await api(ctx, member, 'PATCH', `/clients/${mine.data.id}`, { stage: 'Purchased' })).status).toBe(200);
      expect((await api<any[]>(ctx, member, 'GET', '/clients?search=X5')).data).toHaveLength(1);
      expect((await api(ctx, member, 'DELETE', `/clients/${mine.data.id}`)).status).toBe(200);
    });
  });

  describe('In stock', () => {
    let seller: TestUser;
    let buyer: TestUser;
    let noSales: TestUser;
    let brandId: number;
    let modelId: number;
    let otherBrandModelId: number;
    let carId: number;

    const car = (extra: Record<string, unknown> = {}) => ({
      brandId,
      modelId,
      year: 2019,
      price: 12000,
      mileage: 90000,
      engine: '2.0 Diesel',
      transmission: 'Automatic',
      chassis: 'WBA8E9G50GNU12345',
      location: 'Poland',
      photos: ['/api/uploads/in-stock/a.jpg', '/api/uploads/in-stock/b.jpg'],
      ...extra,
    });

    beforeAll(async () => {
      const status = (key: string, accessStatus: 'Purchase' | 'PurchaseSale' | 'PurchaseNoSales') =>
        createUser(ctx, key, Roles.User).then(async (u) => {
          await ctx.prisma.user.update({ where: { id: u.id }, data: { accessStatus } });
          return u;
        });
      seller = await status('stock-seller', 'PurchaseSale');
      buyer = await status('stock-buyer', 'Purchase');
      noSales = await status('stock-nosales', 'PurchaseNoSales');

      const brands = await api<{ id: number; name: string }[]>(ctx, SA, 'GET', '/in-stock/brands?q=BMW');
      brandId = brands.data.find((b) => b.name === 'Bmw')!.id;
      modelId = (await api<{ id: number }[]>(ctx, SA, 'GET', `/in-stock/brands/${brandId}/models`)).data[0].id;
      const audi = (await api<{ id: number; name: string }[]>(ctx, SA, 'GET', '/in-stock/brands?q=Audi')).data[0];
      otherBrandModelId = (await api<{ id: number }[]>(ctx, SA, 'GET', `/in-stock/brands/${audi.id}/models`)).data[0].id;
    });

    it('only admins and «покупки + продажі» can add cars', async () => {
      expect((await api(ctx, buyer, 'POST', '/in-stock', car())).status).toBe(403);
      const created = await api<any>(ctx, seller, 'POST', '/in-stock', car());
      expect(created.status).toBe(201);
      carId = created.data.id;
      expect(created.data.brandId).toBe(brandId);
      expect(created.data.modelId).toBe(modelId);
      expect(created.data.brand).toBe('Bmw');
      expect(created.data.photos).toEqual(['/api/uploads/in-stock/a.jpg', '/api/uploads/in-stock/b.jpg']);
      expect(created.data.owner.id).toBe(seller.id);
      expect(created.data.canEdit).toBe(true);
    });

    it('validates: empty car, VIN, model of another brand, «sold» on create', async () => {
      expect((await api(ctx, seller, 'POST', '/in-stock', {})).status).toBe(400);
      expect((await api(ctx, seller, 'POST', '/in-stock', car({ chassis: '123' }))).status).toBe(400);
      expect((await api(ctx, seller, 'POST', '/in-stock', car({ modelId: otherBrandModelId }))).status).toBe(400);
      expect((await api(ctx, seller, 'POST', '/in-stock', car({ status: 'sold' }))).status).toBe(400);
    });

    it('others cannot edit or sell; the list shows who can', async () => {
      expect((await api(ctx, buyer, 'PUT', `/in-stock/${carId}`, car({ price: 1 }))).status).toBe(403);
      expect((await api(ctx, buyer, 'POST', `/in-stock/${carId}/sell`)).status).toBe(403);
      const list = await api<any>(ctx, buyer, 'GET', '/in-stock');
      const listed = list.data.cars.find((c: any) => c.id === carId);
      expect(listed.canEdit).toBe(false);
      expect(list.data.canAdd).toBe(false);
    });

    it('owner edits: photo order is kept, fields are not duplicated', async () => {
      const res = await api<any>(ctx, seller, 'PUT', `/in-stock/${carId}`, car({ photos: ['/api/uploads/in-stock/b.jpg'], price: 11000 }));
      expect(res.status).toBe(200);
      expect(res.data.photos).toEqual(['/api/uploads/in-stock/b.jpg']);
      expect(res.data.engine).toBe('2.0 Diesel');
      expect(res.data.price).toBe(11000);
    });

    it('filters by status and price', async () => {
      const cheap = await api<any>(ctx, SA, 'GET', '/in-stock?priceTo=100');
      expect(cheap.data.cars.map((c: any) => c.id)).not.toContain(carId);
      const available = await api<any>(ctx, SA, 'GET', '/in-stock?status=available&priceFrom=10000');
      expect(available.data.cars.map((c: any) => c.id)).toContain(carId);
    });

    it('«без доступу до продажів» does not see the section', async () => {
      expect((await api(ctx, noSales, 'GET', '/in-stock')).status).toBe(403);
    });

    it('owner sells the car', async () => {
      const sold = await api<any>(ctx, seller, 'POST', `/in-stock/${carId}/sell`);
      expect(sold.status).toBe(201);
      expect(sold.data.status).toBe('sold');
      expect(sold.data.canSell).toBe(false);
    });

    it('uploads photos and serves them back', async () => {
      const form = new FormData();
      form.append('files', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'a.jpg');
      const token = ctx.jwt.sign({ id: seller.id, email: seller.email, role: seller.role });
      const up = await fetch(`${ctx.baseUrl}/api/in-stock/photos`, { method: 'POST', body: form, headers: { Cookie: `access_token=${token}` } });
      expect(up.status).toBe(201);
      const { urls } = (await up.json()) as { urls: string[] };
      expect(urls[0]).toMatch(/^\/api\/uploads\/in-stock\/[0-9a-f-]{36}\.jpg$/);
      const file = await fetch(`${ctx.baseUrl}${urls[0]}`);
      expect(file.status).toBe(200);
      expect((await fetch(`${ctx.baseUrl}/api/uploads/in-stock/..%2F..%2Fpackage.json`)).status).toBe(404);
    });
  });
});
