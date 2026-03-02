-- DropForeignKey
ALTER TABLE "auction_auths" DROP CONSTRAINT "auction_auths_auctionId_fkey";

-- AddForeignKey
ALTER TABLE "auction_auths" ADD CONSTRAINT "auction_auths_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
