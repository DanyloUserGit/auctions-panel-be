/*
  P3 cleanup.

  1. "Обране" (selectedAccounts) moves from auction_auths."userId" (one user per account) to the
     many-to-many table "_UserSelectedAccounts". Existing selections are COPIED before the column is dropped.
  2. Legacy "_UserAuctions" (Auction.users) is dropped - it grants no access since P1.
  3. "_GroupAccountAccess" (UserGroup.accounts, "GA access to passwords") is dropped - only SuperAdmin
     may see account data.
  4. New "_UserDeniedAccounts": per-user exclusions from the group's accounts (canGaManageAccounts).
*/

-- 1. Selected accounts: new table first, copy data, then drop the old column.
CREATE TABLE "_UserSelectedAccounts" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_UserSelectedAccounts_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_UserSelectedAccounts_B_index" ON "_UserSelectedAccounts"("B");

ALTER TABLE "_UserSelectedAccounts" ADD CONSTRAINT "_UserSelectedAccounts_A_fkey" FOREIGN KEY ("A") REFERENCES "auction_auths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_UserSelectedAccounts" ADD CONSTRAINT "_UserSelectedAccounts_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "_UserSelectedAccounts" ("A", "B")
SELECT "id", "userId" FROM "auction_auths" WHERE "userId" IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "auction_auths" DROP CONSTRAINT "auction_auths_userId_fkey";

ALTER TABLE "auction_auths" DROP COLUMN "userId";

-- 2. Legacy Auction.users
ALTER TABLE "_UserAuctions" DROP CONSTRAINT "_UserAuctions_A_fkey";

ALTER TABLE "_UserAuctions" DROP CONSTRAINT "_UserAuctions_B_fkey";

DROP TABLE "_UserAuctions";

-- 3. UserGroup.accounts ("GA access to passwords")
ALTER TABLE "_GroupAccountAccess" DROP CONSTRAINT "_GroupAccountAccess_A_fkey";

ALTER TABLE "_GroupAccountAccess" DROP CONSTRAINT "_GroupAccountAccess_B_fkey";

DROP TABLE "_GroupAccountAccess";

-- 4. Per-user exclusions from group accounts
CREATE TABLE "_UserDeniedAccounts" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_UserDeniedAccounts_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_UserDeniedAccounts_B_index" ON "_UserDeniedAccounts"("B");

ALTER TABLE "_UserDeniedAccounts" ADD CONSTRAINT "_UserDeniedAccounts_A_fkey" FOREIGN KEY ("A") REFERENCES "auction_auths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_UserDeniedAccounts" ADD CONSTRAINT "_UserDeniedAccounts_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
