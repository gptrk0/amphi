/*
  A cím/poszter nem kerül a DB-be — csak tmdbId + type + letöltési állapot tárolódik,
  a metaadat a TMDB-ből jön (cache-elve, ld. src/lib/media.ts).

*/
-- AlterTable
ALTER TABLE "Watchlist" DROP COLUMN "posterPath",
DROP COLUMN "title";

-- AlterTable
ALTER TABLE "WatchlistEpisode" DROP COLUMN "title";
