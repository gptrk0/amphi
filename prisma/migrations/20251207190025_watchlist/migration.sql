-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('MOVIE', 'TV');

-- CreateTable
CREATE TABLE "Watchlist" (
    "tmdbid" INTEGER NOT NULL,
    "type" "ContentType" NOT NULL DEFAULT 'MOVIE',
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_tmdbid_key" ON "Watchlist"("tmdbid");
