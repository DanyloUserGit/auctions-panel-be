/*
  Warnings:

  - You are about to drop the column `auctionGroupId` on the `auction_auths` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "auction_auths" DROP CONSTRAINT "auction_auths_auctionGroupId_fkey";

-- AlterTable
ALTER TABLE "auction_auths" DROP COLUMN "auctionGroupId";

-- CreateTable
CREATE TABLE "_GroupAccountAccess" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_GroupAccountAccess_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_GroupAccountAccess_B_index" ON "_GroupAccountAccess"("B");

-- AddForeignKey
ALTER TABLE "_GroupAccountAccess" ADD CONSTRAINT "_GroupAccountAccess_A_fkey" FOREIGN KEY ("A") REFERENCES "auction_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupAccountAccess" ADD CONSTRAINT "_GroupAccountAccess_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
