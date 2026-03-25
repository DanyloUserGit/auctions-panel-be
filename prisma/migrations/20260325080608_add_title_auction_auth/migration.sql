/*
  Warnings:

  - Added the required column `title` to the `auction_auths` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "auction_auths" ADD COLUMN     "title" TEXT NOT NULL;
