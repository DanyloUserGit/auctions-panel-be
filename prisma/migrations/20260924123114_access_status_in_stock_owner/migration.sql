-- CreateEnum
CREATE TYPE "AccessStatus" AS ENUM ('ReadOnly', 'Purchase', 'PurchaseSale', 'PurchaseNoSales');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "accessStatus" "AccessStatus" NOT NULL DEFAULT 'ReadOnly';

-- CreateTable
CREATE TABLE "in_stock_car_owners" (
    "carId" INTEGER NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "in_stock_car_owners_pkey" PRIMARY KEY ("carId")
);

-- AddForeignKey
ALTER TABLE "in_stock_car_owners" ADD CONSTRAINT "in_stock_car_owners_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Перенесення наявних прав у статус доступу (ТЗ 12): Buy -> «Дозволені покупки»,
-- Sell/All -> «Дозволені покупки + дозволені продажі», решта лишається «Тільки перегляд».
UPDATE "users" SET "accessStatus" = 'Purchase' WHERE "sessionRights" = 'Buy';
UPDATE "users" SET "accessStatus" = 'PurchaseSale' WHERE "sessionRights" IN ('Sell', 'All');
