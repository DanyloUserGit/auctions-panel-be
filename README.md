# auctions-panel-be

Бекенд панелі віддаленої роботи з аукціонами:
- `apps/auctions-panel-be` - API на NestJS з PostgreSQL (Prisma), сокетами сесій і сповіщень;
- `apps/browser-worker` - воркер браузерів: Playwright, автологін, правила контролю дій, WebRTC-трансляція.

- Розгортання й перенесення на інший сервер: [`../docs/deployment.md`](../docs/deployment.md).
- Змінні оточення: `.env.example` (compose і воркер), `apps/auctions-panel-be/.env.example` (API).

## Локальний запуск

```bash
npm install
cp .env.example .env && cp apps/auctions-panel-be/.env.example apps/auctions-panel-be/.env
docker compose -f docker-compose.dev.yml up -d   # бази та RabbitMQ
npx prisma migrate deploy && npx prisma generate
npm run start:dev                                  # API
npx nest start browser-worker --watch              # воркер (потрібні: npx playwright install chromium, ffmpeg)
```

## Тести

- `npx jest apps/browser-worker/src` - воркер на справжньому Chromium: правила, журналювання, popup.
- `npm run test:e2e:access` - e2e API: доступи, сесії, ліміти, CRM-модулі, сповіщення, аудит (див. нижче).

## e2e-тести API

End-to-end tests for the access model (user group → auction group → auction → account, personal
access, GA account denials, `showAccounts`, auction-group `sessionLimit` including concurrent starts).
They run the real API against a real PostgreSQL + RabbitMQ and **truncate every table**, so they only
start when `TEST_DATABASE_URL` points to a database whose name contains `test`.

```bash
# 1. ізольована інфраструктура (Postgres 55440, RabbitMQ 55672, MariaDB 55306/55307)
docker compose -f docker-compose.test.yml up -d

# 2. apply migrations to the test database
DATABASE_URL=postgresql://postgres:test@localhost:55440/auctions_e2e_test npx prisma migrate deploy

# 3. run the tests
TEST_DATABASE_URL=postgresql://postgres:test@localhost:55440/auctions_e2e_test npm run test:e2e:access

# 4. clean up
docker compose -f docker-compose.test.yml down
```

`TEST_RABBITMQ_URL` overrides the default `amqp://localhost:55672`. Browser-worker sessions are only
queued, never started.
