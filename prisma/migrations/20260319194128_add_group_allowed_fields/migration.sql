-- AlterTable
ALTER TABLE "auction_groups" ADD COLUMN     "allowedProfileFields" TEXT[] DEFAULT ARRAY['firstName', 'lastName', 'phone', 'city']::TEXT[];
