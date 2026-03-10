-- CreateEnum
CREATE TYPE "SessionEventType" AS ENUM ('ForbiddenAction', 'Navigation', 'SessionError', 'TextInput', 'ButtonClick', 'Other');

-- CreateEnum
CREATE TYPE "LogSeverity" AS ENUM ('Info', 'Warning', 'Critical');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "endedById" UUID;

-- CreateTable
CREATE TABLE "session_logs" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID,
    "eventType" "SessionEventType" NOT NULL,
    "severity" "LogSeverity" NOT NULL DEFAULT 'Info',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "isIncident" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_logs_sessionId_idx" ON "session_logs"("sessionId");

-- CreateIndex
CREATE INDEX "session_logs_eventType_idx" ON "session_logs"("eventType");

-- CreateIndex
CREATE INDEX "session_logs_isIncident_idx" ON "session_logs"("isIncident");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
