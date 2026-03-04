/*
  Warnings:

  - A unique constraint covering the columns `[groupAdminId]` on the table `auction_groups` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('InApp', 'Email', 'Telegram', 'Viber');

-- AlterTable
ALTER TABLE "auction_groups" ADD COLUMN     "groupAdminId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auctionGroupId" UUID,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastActivity" TIMESTAMP(3),
ADD COLUMN     "lastLogin" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "sessionLimit" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "notification_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "notification_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_settings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "notificationTypeId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "channels" "NotificationChannel"[] DEFAULT ARRAY['InApp']::"NotificationChannel"[],

    CONSTRAINT "user_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_notification_requirements" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "notificationTypeId" UUID NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "group_notification_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_types_name_key" ON "notification_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_settings_userId_notificationTypeId_key" ON "user_notification_settings"("userId", "notificationTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "group_notification_requirements_groupId_notificationTypeId_key" ON "group_notification_requirements"("groupId", "notificationTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_groups_groupAdminId_key" ON "auction_groups"("groupAdminId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_auctionGroupId_fkey" FOREIGN KEY ("auctionGroupId") REFERENCES "auction_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_notificationTypeId_fkey" FOREIGN KEY ("notificationTypeId") REFERENCES "notification_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_notification_requirements" ADD CONSTRAINT "group_notification_requirements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "auction_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_notification_requirements" ADD CONSTRAINT "group_notification_requirements_notificationTypeId_fkey" FOREIGN KEY ("notificationTypeId") REFERENCES "notification_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_groups" ADD CONSTRAINT "auction_groups_groupAdminId_fkey" FOREIGN KEY ("groupAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
