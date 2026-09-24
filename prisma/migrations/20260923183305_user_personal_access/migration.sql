-- CreateTable
CREATE TABLE "_UserPersonalAccounts" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_UserPersonalAccounts_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_UserPersonalAuctions" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_UserPersonalAuctions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_UserPersonalAuctionGroups" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_UserPersonalAuctionGroups_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_UserPersonalAccounts_B_index" ON "_UserPersonalAccounts"("B");

-- CreateIndex
CREATE INDEX "_UserPersonalAuctions_B_index" ON "_UserPersonalAuctions"("B");

-- CreateIndex
CREATE INDEX "_UserPersonalAuctionGroups_B_index" ON "_UserPersonalAuctionGroups"("B");

-- AddForeignKey
ALTER TABLE "_UserPersonalAccounts" ADD CONSTRAINT "_UserPersonalAccounts_A_fkey" FOREIGN KEY ("A") REFERENCES "auction_auths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserPersonalAccounts" ADD CONSTRAINT "_UserPersonalAccounts_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserPersonalAuctions" ADD CONSTRAINT "_UserPersonalAuctions_A_fkey" FOREIGN KEY ("A") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserPersonalAuctions" ADD CONSTRAINT "_UserPersonalAuctions_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserPersonalAuctionGroups" ADD CONSTRAINT "_UserPersonalAuctionGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "auction_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserPersonalAuctionGroups" ADD CONSTRAINT "_UserPersonalAuctionGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
