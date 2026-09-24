-- CreateTable
CREATE TABLE "_UserGroupAllowedAccounts" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_UserGroupAllowedAccounts_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_UserGroupAllowedAuctionGroups" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_UserGroupAllowedAuctionGroups_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_UserGroupAllowedAccounts_B_index" ON "_UserGroupAllowedAccounts"("B");

-- CreateIndex
CREATE INDEX "_UserGroupAllowedAuctionGroups_B_index" ON "_UserGroupAllowedAuctionGroups"("B");

-- AddForeignKey
ALTER TABLE "_UserGroupAllowedAccounts" ADD CONSTRAINT "_UserGroupAllowedAccounts_A_fkey" FOREIGN KEY ("A") REFERENCES "auction_auths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserGroupAllowedAccounts" ADD CONSTRAINT "_UserGroupAllowedAccounts_B_fkey" FOREIGN KEY ("B") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserGroupAllowedAuctionGroups" ADD CONSTRAINT "_UserGroupAllowedAuctionGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "auction_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserGroupAllowedAuctionGroups" ADD CONSTRAINT "_UserGroupAllowedAuctionGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
