/*
  Warnings:

  - You are about to drop the column `value` on the `notification_types` table. All the data in the column will be lost.
  - Added the required column `value` to the `user_notification_settings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "notification_types" DROP COLUMN "value";

-- AlterTable
ALTER TABLE "user_notification_settings" ADD COLUMN     "value" INTEGER NOT NULL;
