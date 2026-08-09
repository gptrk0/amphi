-- The watchlist stops being the install's and becomes each person's. The library does
-- not: there is one file on the disk however many people were waiting for it.

-- a chat of one's own, separate from the install-wide one in the settings
ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramEvents" TEXT NOT NULL DEFAULT 'ready';

-- Everything on the list so far was put there before anybody had an account, so it
-- belongs to whoever claimed the install. With no administrator at all there is nobody
-- to own it, and a row nobody owns cannot exist under the new rule.
ALTER TABLE "Watchlist" ADD COLUMN "userId" INTEGER;

UPDATE "Watchlist"
   SET "userId" = (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "id" LIMIT 1);

DELETE FROM "Watchlist" WHERE "userId" IS NULL;

ALTER TABLE "Watchlist" ALTER COLUMN "userId" SET NOT NULL;

DROP INDEX "Watchlist_tmdbId_type_key";

CREATE UNIQUE INDEX "Watchlist_userId_tmdbId_type_key" ON "Watchlist"("userId", "tmdbId", "type");
CREATE INDEX "Watchlist_tmdbId_type_idx" ON "Watchlist"("tmdbId", "type");

ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `watched` said whether the install was watching this. With one list per person that
-- question has as many answers as there are people, so it becomes the list of them.
ALTER TABLE "Library" ADD COLUMN "watchedBy" INTEGER[] NOT NULL DEFAULT '{}';

UPDATE "Library"
   SET "watchedBy" = ARRAY[(SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "id" LIMIT 1)]
 WHERE "watched" = true
   AND EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN');

ALTER TABLE "Library" DROP COLUMN "watched";
