/*
  Warnings:

  - You are about to drop the `notification_types` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "NotificationConfigType" AS ENUM ('Configurable', 'System');

-- DropForeignKey
ALTER TABLE "group_notification_requirements" DROP CONSTRAINT "group_notification_requirements_notificationTypeId_fkey";

-- DropForeignKey
ALTER TABLE "user_notification_settings" DROP CONSTRAINT "user_notification_settings_notificationTypeId_fkey";

-- DropTable
DROP TABLE "notification_types";

-- CreateTable
CREATE TABLE "NotificationType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "roles" "Roles"[],
    "configType" "NotificationConfigType" NOT NULL DEFAULT 'Configurable',
    "setting" JSONB,

    CONSTRAINT "NotificationType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationType_name_key" ON "NotificationType"("name");

-- AddForeignKey
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_notificationTypeId_fkey" FOREIGN KEY ("notificationTypeId") REFERENCES "NotificationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_notification_requirements" ADD CONSTRAINT "group_notification_requirements_notificationTypeId_fkey" FOREIGN KEY ("notificationTypeId") REFERENCES "NotificationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
