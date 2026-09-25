-- DropForeignKey
ALTER TABLE "allowed_routes" DROP CONSTRAINT "allowed_routes_auctionId_fkey";

-- DropForeignKey
ALTER TABLE "forbidden_routes" DROP CONSTRAINT "forbidden_routes_auctionId_fkey";

-- DropForeignKey
ALTER TABLE "forbidden_selectors" DROP CONSTRAINT "forbidden_selectors_auctionId_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_auctionId_fkey";

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_routes" ADD CONSTRAINT "allowed_routes_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forbidden_routes" ADD CONSTRAINT "forbidden_routes_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forbidden_selectors" ADD CONSTRAINT "forbidden_selectors_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
