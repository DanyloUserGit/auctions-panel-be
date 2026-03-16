-- AlterTable
ALTER TABLE "auction_auths" ADD COLUMN     "auctionGroupId" UUID;

-- AlterTable
ALTER TABLE "auction_groups" ADD COLUMN     "canGaManageAccounts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rules" JSONB DEFAULT '{}',
ADD COLUMN     "sessionLimit" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "auction_auths" ADD CONSTRAINT "auction_auths_auctionGroupId_fkey" FOREIGN KEY ("auctionGroupId") REFERENCES "auction_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
