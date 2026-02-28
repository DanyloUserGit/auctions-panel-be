/*
  Warnings:

  - The values [ReadAndWrite,Buy,Sell,BuyAndSell] on the enum `Rights` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "SessionRights" AS ENUM ('Read', 'Buy', 'Sell', 'All');

-- AlterEnum
BEGIN;
CREATE TYPE "Rights_new" AS ENUM ('Read', 'Write', 'All');
ALTER TABLE "public"."users" ALTER COLUMN "rights" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "rights" TYPE "Rights_new" USING ("rights"::text::"Rights_new");
ALTER TYPE "Rights" RENAME TO "Rights_old";
ALTER TYPE "Rights_new" RENAME TO "Rights";
DROP TYPE "public"."Rights_old";
ALTER TABLE "users" ALTER COLUMN "rights" SET DEFAULT 'Read';
COMMIT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sessionRights" "SessionRights" NOT NULL DEFAULT 'Read';
