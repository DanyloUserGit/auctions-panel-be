-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "auctionGroupId" UUID;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_auctionGroupId_fkey" FOREIGN KEY ("auctionGroupId") REFERENCES "auction_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
