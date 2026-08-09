ALTER TABLE "Watchlist" ADD COLUMN "monitorNewSeasons" BOOLEAN NOT NULL DEFAULT false;

-- Until now a season the show had never had inherited the flag of the latest season
-- that did exist, which worked because every season had rows whether it was watched
-- or not. Rows now exist only for what is watched, so the same inheritance would
-- adopt every season that was simply never picked. Reproduce the old decision once,
-- from the data as it stands: a show whose newest season is watched keeps following
-- the show.
UPDATE "Watchlist" SET "monitorNewSeasons" = true
WHERE "type" = 'TV'
  AND EXISTS (
    SELECT 1 FROM "WatchlistUnit" u
    WHERE u."watchlistId" = "Watchlist"."id"
      AND u."monitored"
      AND u."seasonNumber" = (
        SELECT MAX(u2."seasonNumber") FROM "WatchlistUnit" u2 WHERE u2."watchlistId" = "Watchlist"."id"
      )
  );
