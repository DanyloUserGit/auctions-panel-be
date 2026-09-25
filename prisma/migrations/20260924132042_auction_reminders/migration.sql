-- CreateTable
CREATE TABLE "auction_reminders" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auction_reminders_sentAt_remindAt_idx" ON "auction_reminders"("sentAt", "remindAt");

-- AddForeignKey
ALTER TABLE "auction_reminders" ADD CONSTRAINT "auction_reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
