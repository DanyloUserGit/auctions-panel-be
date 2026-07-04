/*
  Warnings:

  - Added the required column `value` to the `notification_types` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "notification_types" ADD COLUMN     "value" INTEGER NOT NULL;
