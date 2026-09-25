-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('Route', 'Selector');

-- CreateEnum
CREATE TYPE "RuleEffect" AS ENUM ('Forbid', 'Allow');

-- AlterTable
ALTER TABLE "user_groups" ADD COLUMN     "canGaManageRules" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "access_rules" (
    "id" UUID NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "value" TEXT NOT NULL,
    "effect" "RuleEffect" NOT NULL DEFAULT 'Forbid',
    "isBuyAction" BOOLEAN NOT NULL DEFAULT false,
    "auctionId" UUID,
    "userGroupId" UUID,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_rules_auctionId_idx" ON "access_rules"("auctionId");

-- CreateIndex
CREATE INDEX "access_rules_userGroupId_idx" ON "access_rules"("userGroupId");

-- CreateIndex
CREATE INDEX "access_rules_userId_idx" ON "access_rules"("userId");

-- AddForeignKey
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_userGroupId_fkey" FOREIGN KEY ("userGroupId") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
