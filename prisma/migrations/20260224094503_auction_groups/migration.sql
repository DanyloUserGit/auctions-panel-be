/*
  Warnings:

  - Added the required column `title` to the `auctions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "auctions" ADD COLUMN     "auctionGroupId" UUID,
ADD COLUMN     "title" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "auction_groups" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "auction_groups_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_auctionGroupId_fkey" FOREIGN KEY ("auctionGroupId") REFERENCES "auction_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
