-- A unit is stored for something that is watched or something that is already had.
-- Until now every episode of every season of every show on the watchlist had a row,
-- almost all of them unwatched and untouched: 30 rows for a show that was followed
-- by four episodes, and every one of them rewritten on each metadata round.
--
-- Episodes only. A film always keeps its single unit, and a film row with nothing
-- left is removed by the application, not from here.
DELETE FROM "WatchlistUnit"
WHERE "seasonNumber" IS NOT NULL
  AND "monitored" = false
  AND "status" NOT IN ('DOWNLOADING', 'DOWNLOADED');

-- Whatever is left with no units at all was only ever held up by those rows.
DELETE FROM "Watchlist"
WHERE NOT EXISTS (SELECT 1 FROM "WatchlistUnit" WHERE "WatchlistUnit"."watchlistId" = "Watchlist"."id");
