-- CreateTable
CREATE TABLE "forbidden_routes" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "auctionId" UUID NOT NULL,

    CONSTRAINT "forbidden_routes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "forbidden_routes" ADD CONSTRAINT "forbidden_routes_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
