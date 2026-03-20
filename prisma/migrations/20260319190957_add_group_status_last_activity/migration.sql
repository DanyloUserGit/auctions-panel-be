/*
  Warnings:

  - Added the required column `isActive` to the `auction_groups` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "auction_groups" ADD COLUMN     "isActive" BOOLEAN NOT NULL,
ADD COLUMN     "lastActivity" TIMESTAMP(3);
