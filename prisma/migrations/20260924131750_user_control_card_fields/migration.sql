-- AlterTable
ALTER TABLE "users" ADD COLUMN     "adminComment" TEXT,
ADD COLUMN     "adminExtra" TEXT,
ADD COLUMN     "contractNumber" TEXT,
ADD COLUMN     "depositAmount" DECIMAL(12,2),
ADD COLUMN     "depositMethod" TEXT,
ADD COLUMN     "hasContract" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "middleName" TEXT;
