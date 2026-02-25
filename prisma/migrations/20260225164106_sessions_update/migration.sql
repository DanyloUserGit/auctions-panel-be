/*
  Warnings:

  - Added the required column `activeConnections` to the `sessions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `isActive` to the `sessions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxConnections` to the `sessions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "activeConnections" INTEGER NOT NULL,
ADD COLUMN     "isActive" BOOLEAN NOT NULL,
ADD COLUMN     "maxConnections" INTEGER NOT NULL,
ADD COLUMN     "workerId" UUID;

-- CreateTable
CREATE TABLE "allowed_routes" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "auctionId" UUID NOT NULL,

    CONSTRAINT "allowed_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forbidden_selectors" (
    "id" UUID NOT NULL,
    "selector" TEXT NOT NULL,
    "auctionId" UUID NOT NULL,

    CONSTRAINT "forbidden_selectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_routes" ADD CONSTRAINT "allowed_routes_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forbidden_selectors" ADD CONSTRAINT "forbidden_selectors_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
