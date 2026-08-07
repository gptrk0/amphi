-- CreateTable
CREATE TABLE "WatchlistUnit" (
    "id" SERIAL NOT NULL,
    "watchlistId" INTEGER NOT NULL,
    "seasonId" INTEGER,
    "episodeNumber" INTEGER,
    "airDate" TIMESTAMP(3),
    "status" "WatchStatus" NOT NULL DEFAULT 'PENDING',
    "torrentHash" TEXT,
    "searchAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "WatchlistUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchlistUnit_watchlistId_idx" ON "WatchlistUnit"("watchlistId");

-- CreateIndex
CREATE INDEX "WatchlistUnit_status_idx" ON "WatchlistUnit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistUnit_seasonId_episodeNumber_key" ON "WatchlistUnit"("seasonId", "episodeNumber");

-- AddForeignKey
ALTER TABLE "WatchlistUnit" ADD CONSTRAINT "WatchlistUnit_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistUnit" ADD CONSTRAINT "WatchlistUnit_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "WatchlistSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the movie download state over to its single unit before the columns go.
INSERT INTO "WatchlistUnit" ("watchlistId", "status", "torrentHash", "searchAttempts", "lastCheckedAt")
SELECT "id", "status", "torrentHash", "searchAttempts", "lastCheckedAt"
FROM "Watchlist"
WHERE "type" = 'MOVIE';

-- Every episode becomes a unit, keeping its season link and download state.
INSERT INTO "WatchlistUnit" ("watchlistId", "seasonId", "episodeNumber", "airDate", "status", "torrentHash", "searchAttempts", "lastCheckedAt")
SELECT s."watchlistId", e."seasonId", e."episodeNumber", e."airDate", e."status", e."torrentHash", e."searchAttempts", e."lastCheckedAt"
FROM "WatchlistEpisode" e
JOIN "WatchlistSeason" s ON s."id" = e."seasonId";

-- DropForeignKey
ALTER TABLE "WatchlistEpisode" DROP CONSTRAINT "WatchlistEpisode_seasonId_fkey";

-- AlterTable
ALTER TABLE "Watchlist" DROP COLUMN "lastCheckedAt",
DROP COLUMN "searchAttempts",
DROP COLUMN "status",
DROP COLUMN "torrentHash";

-- DropTable
DROP TABLE "WatchlistEpisode";
