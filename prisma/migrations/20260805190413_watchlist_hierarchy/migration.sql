/*
  Warnings:

  - The `Watchlist` table is restructured: `tmdbid` -> `tmdbId`, `createAt` -> `addedAt`,
    plus a real `id` primary key and download-state columns. The table was never written to
    by the application, so the dropped columns contain no data.

*/
-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('PENDING', 'SEARCHING', 'DOWNLOADING', 'DOWNLOADED', 'FAILED');

-- DropIndex
DROP INDEX "Watchlist_tmdbid_key";

-- AlterTable
ALTER TABLE "Watchlist" DROP COLUMN "createAt",
DROP COLUMN "tmdbid",
ADD COLUMN     "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "id" SERIAL NOT NULL,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "posterPath" TEXT,
ADD COLUMN     "searchAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "WatchStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "title" TEXT NOT NULL,
ADD COLUMN     "tmdbId" INTEGER NOT NULL,
ADD COLUMN     "torrentHash" TEXT,
ADD CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "WatchlistSeason" (
    "id" SERIAL NOT NULL,
    "watchlistId" INTEGER NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "monitored" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WatchlistSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistEpisode" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "title" TEXT,
    "airDate" TIMESTAMP(3),
    "status" "WatchStatus" NOT NULL DEFAULT 'PENDING',
    "torrentHash" TEXT,
    "searchAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "WatchlistEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistSeason_watchlistId_seasonNumber_key" ON "WatchlistSeason"("watchlistId", "seasonNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistEpisode_seasonId_episodeNumber_key" ON "WatchlistEpisode"("seasonId", "episodeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_tmdbId_type_key" ON "Watchlist"("tmdbId", "type");

-- AddForeignKey
ALTER TABLE "WatchlistSeason" ADD CONSTRAINT "WatchlistSeason_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistEpisode" ADD CONSTRAINT "WatchlistEpisode_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "WatchlistSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
