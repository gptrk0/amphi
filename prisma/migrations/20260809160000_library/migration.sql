CREATE TYPE "LibraryStatus" AS ENUM ('DOWNLOADING', 'AVAILABLE');

CREATE TABLE "LibraryItem" (
    "id" SERIAL NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "type" "ContentType" NOT NULL,
    "releaseTitle" TEXT NOT NULL DEFAULT '',
    "torrentHash" TEXT,
    "status" "LibraryStatus" NOT NULL DEFAULT 'DOWNLOADING',
    "watched" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "seedUntil" TIMESTAMP(3),
    "deleteRequested" BOOLEAN NOT NULL DEFAULT false,
    "deleteFiles" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryEpisode" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "episodeNumber" INTEGER NOT NULL,

    CONSTRAINT "LibraryEpisode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LibraryItem_tmdbId_type_idx" ON "LibraryItem"("tmdbId", "type");
CREATE INDEX "LibraryItem_torrentHash_idx" ON "LibraryItem"("torrentHash");
CREATE INDEX "LibraryItem_status_idx" ON "LibraryItem"("status");
CREATE INDEX "LibraryEpisode_seasonNumber_episodeNumber_idx" ON "LibraryEpisode"("seasonNumber", "episodeNumber");
CREATE UNIQUE INDEX "LibraryEpisode_itemId_seasonNumber_episodeNumber_key" ON "LibraryEpisode"("itemId", "seasonNumber", "episodeNumber");

ALTER TABLE "LibraryEpisode" ADD CONSTRAINT "LibraryEpisode_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "LibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What is already downloaded or downloading moves over. One row per torrent, which
-- is exactly how the units were grouped anyway: a season pack shares one hash.
INSERT INTO "LibraryItem" ("tmdbId", "type", "torrentHash", "status", "watched", "startedAt", "completedAt", "seedUntil")
SELECT
    w."tmdbId",
    w."type",
    u."torrentHash",
    CASE WHEN bool_and(u."status" = 'DOWNLOADED') THEN 'AVAILABLE'::"LibraryStatus" ELSE 'DOWNLOADING'::"LibraryStatus" END,
    bool_or(u."monitored"),
    min(w."addedAt"),
    -- the moment it finished was never stored; the row's own last change is the
    -- closest thing to it, and it only decides when the seed lock lifts
    CASE WHEN bool_and(u."status" = 'DOWNLOADED') THEN min(w."updatedAt") ELSE NULL END,
    CASE WHEN bool_and(u."status" = 'DOWNLOADED') THEN min(w."updatedAt") + interval '3 days' ELSE NULL END
FROM "WatchlistUnit" u
JOIN "Watchlist" w ON w."id" = u."watchlistId"
WHERE u."torrentHash" IS NOT NULL AND u."status" IN ('DOWNLOADING', 'DOWNLOADED')
GROUP BY w."tmdbId", w."type", u."torrentHash";

INSERT INTO "LibraryEpisode" ("itemId", "seasonNumber", "episodeNumber")
SELECT DISTINCT l."id", u."seasonNumber", u."episodeNumber"
FROM "WatchlistUnit" u
JOIN "Watchlist" w ON w."id" = u."watchlistId"
JOIN "LibraryItem" l ON l."tmdbId" = w."tmdbId" AND l."type" = w."type" AND l."torrentHash" = u."torrentHash"
WHERE u."seasonNumber" IS NOT NULL AND u."episodeNumber" IS NOT NULL
  AND u."status" IN ('DOWNLOADING', 'DOWNLOADED');

-- The watchlist keeps only what is still to be found.
DELETE FROM "WatchlistUnit" WHERE "status" IN ('DOWNLOADING', 'DOWNLOADED');

DELETE FROM "Watchlist"
WHERE NOT EXISTS (SELECT 1 FROM "WatchlistUnit" WHERE "WatchlistUnit"."watchlistId" = "Watchlist"."id");
