-- CreateEnum
CREATE TYPE "ClientStage" AS ENUM ('New', 'Searching', 'Negotiation', 'Purchased', 'Delivered', 'Closed');

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "lookingFor" TEXT,
    "stage" "ClientStage" NOT NULL DEFAULT 'New',
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_ownerId_idx" ON "clients"("ownerId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
