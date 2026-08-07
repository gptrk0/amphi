-- AlterTable
ALTER TABLE "WatchlistUnit" ADD COLUMN     "monitored" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "seasonNumber" INTEGER;

-- Fold the season into the unit before the table goes. A movie unit has no season,
-- so it keeps the default: monitored, no season number.
UPDATE "WatchlistUnit" u
SET "seasonNumber" = s."seasonNumber", "monitored" = s."monitored"
FROM "WatchlistSeason" s
WHERE s."id" = u."seasonId";

-- DropForeignKey
ALTER TABLE "WatchlistSeason" DROP CONSTRAINT "WatchlistSeason_watchlistId_fkey";

-- DropForeignKey
ALTER TABLE "WatchlistUnit" DROP CONSTRAINT "WatchlistUnit_seasonId_fkey";

-- DropIndex
DROP INDEX "WatchlistUnit_seasonId_episodeNumber_key";

-- DropIndex
DROP INDEX "WatchlistUnit_watchlistId_idx";

-- AlterTable
ALTER TABLE "WatchlistUnit" DROP COLUMN "seasonId";

-- DropTable
DROP TABLE "WatchlistSeason";

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistUnit_watchlistId_seasonNumber_episodeNumber_key" ON "WatchlistUnit"("watchlistId", "seasonNumber", "episodeNumber");
