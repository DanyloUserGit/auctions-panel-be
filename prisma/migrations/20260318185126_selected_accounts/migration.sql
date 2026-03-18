-- AlterTable
ALTER TABLE "auction_auths" ADD COLUMN     "userId" UUID;

-- AddForeignKey
ALTER TABLE "auction_auths" ADD CONSTRAINT "auction_auths_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
