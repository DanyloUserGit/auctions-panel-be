/*
  Warnings:

  - You are about to drop the column `AdminId` on the `auction_groups` table. All the data in the column will be lost.
  - You are about to drop the column `allowedProfileFields` on the `auction_groups` table. All the data in the column will be lost.
  - You are about to drop the column `canGaManageAccounts` on the `auction_groups` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `auction_groups` table. All the data in the column will be lost.
  - You are about to drop the column `lastActivity` on the `auction_groups` table. All the data in the column will be lost.
  - You are about to drop the column `rules` on the `auction_groups` table. All the data in the column will be lost.
  - You are about to drop the column `showAccounts` on the `auction_groups` table. All the data in the column will be lost.
  - You are about to drop the column `auctionGroupId` on the `users` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "_GroupAccountAccess" DROP CONSTRAINT "_GroupAccountAccess_A_fkey";

-- DropForeignKey
ALTER TABLE "_GroupAccountAccess" DROP CONSTRAINT "_GroupAccountAccess_B_fkey";

-- DropForeignKey
ALTER TABLE "auction_groups" DROP CONSTRAINT "auction_groups_AdminId_fkey";

-- DropForeignKey
ALTER TABLE "group_notification_requirements" DROP CONSTRAINT "group_notification_requirements_groupId_fkey";

-- DropForeignKey
ALTER TABLE "training_materials" DROP CONSTRAINT "training_materials_groupId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_auctionGroupId_fkey";

-- DropIndex
DROP INDEX "auction_groups_AdminId_key";

-- AlterTable
ALTER TABLE "auction_groups" DROP COLUMN "AdminId",
DROP COLUMN "allowedProfileFields",
DROP COLUMN "canGaManageAccounts",
DROP COLUMN "isActive",
DROP COLUMN "lastActivity",
DROP COLUMN "rules",
DROP COLUMN "showAccounts";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "auctionGroupId",
ADD COLUMN     "userGroupId" UUID;

-- CreateTable
CREATE TABLE "user_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canGaManageAccounts" BOOLEAN NOT NULL DEFAULT false,
    "showAccounts" BOOLEAN NOT NULL DEFAULT true,
    "rules" JSONB DEFAULT '{}',
    "lastActivity" TIMESTAMP(3),
    "allowedProfileFields" TEXT[] DEFAULT ARRAY['firstName', 'lastName', 'phone', 'city']::TEXT[],
    "AdminId" UUID,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_UserGroupAllowedAuctions" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_UserGroupAllowedAuctions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_AdminId_key" ON "user_groups"("AdminId");

-- CreateIndex
CREATE INDEX "_UserGroupAllowedAuctions_B_index" ON "_UserGroupAllowedAuctions"("B");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_userGroupId_fkey" FOREIGN KEY ("userGroupId") REFERENCES "user_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_materials" ADD CONSTRAINT "training_materials_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_notification_requirements" ADD CONSTRAINT "group_notification_requirements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_AdminId_fkey" FOREIGN KEY ("AdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupAccountAccess" ADD CONSTRAINT "_GroupAccountAccess_A_fkey" FOREIGN KEY ("A") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupAccountAccess" ADD CONSTRAINT "_GroupAccountAccess_B_fkey" FOREIGN KEY ("B") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserGroupAllowedAuctions" ADD CONSTRAINT "_UserGroupAllowedAuctions_A_fkey" FOREIGN KEY ("A") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserGroupAllowedAuctions" ADD CONSTRAINT "_UserGroupAllowedAuctions_B_fkey" FOREIGN KEY ("B") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
