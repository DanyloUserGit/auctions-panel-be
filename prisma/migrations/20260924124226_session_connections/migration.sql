-- Підключення користувачів до сесій (many-to-many) замість users.sessionId, статус/причина завершення,
-- активність сесії для таймауту бездіяльності, ліміт сесій групи користувачів.

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('Admin', 'Inactivity', 'NoConnections', 'Error');

-- CreateTable
CREATE TABLE "session_connections" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "session_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_connections_sessionId_disconnectedAt_idx" ON "session_connections"("sessionId", "disconnectedAt");

-- CreateIndex
CREATE INDEX "session_connections_userId_disconnectedAt_idx" ON "session_connections"("userId", "disconnectedAt");

-- AddForeignKey
ALTER TABLE "session_connections" ADD CONSTRAINT "session_connections_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_connections" ADD CONSTRAINT "session_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "endReason" "SessionEndReason",
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Перенесення: остання сесія кожного користувача стає (завершеним) підключенням, щоб історія
-- «Всіх дій» зберегла учасників. Під час оновлення воркер перезапускається, тому незавершені
-- сесії закриваються - користувачі автоматично підключаться до нових.
INSERT INTO "session_connections" ("id", "sessionId", "userId", "connectedAt", "disconnectedAt")
SELECT gen_random_uuid(), u."sessionId", u."id", s."createdAt", COALESCE(s."endedAt", CURRENT_TIMESTAMP)
FROM "users" u JOIN "sessions" s ON s."id" = u."sessionId";

UPDATE "sessions" SET "isActive" = false, "activeConnections" = 0, "endedAt" = CURRENT_TIMESTAMP, "endReason" = 'NoConnections'
WHERE "isActive" = true;

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_sessionId_fkey";

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "expiresAt";

-- AlterTable
ALTER TABLE "user_groups" ADD COLUMN     "sessionLimit" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
-- Особистий ліміт раніше не застосовувався, а 1 стояло за замовчуванням у всіх; 0 - «без особистого ліміту».
ALTER TABLE "users" DROP COLUMN "sessionId",
ALTER COLUMN "sessionLimit" SET DEFAULT 0;
UPDATE "users" SET "sessionLimit" = 0 WHERE "sessionLimit" = 1;
