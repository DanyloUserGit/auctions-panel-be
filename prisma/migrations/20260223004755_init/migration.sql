-- CreateEnum
CREATE TYPE "Roles" AS ENUM ('SuperAdmin', 'Admin', 'User');

-- CreateEnum
CREATE TYPE "Rights" AS ENUM ('Read', 'Write', 'ReadAndWrite', 'Buy', 'Sell', 'BuyAndSell');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'User',
    "rights" TEXT NOT NULL DEFAULT 'Read',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
