ALTER TABLE "WatchlistUnit" ADD COLUMN "searchingSince" TIMESTAMP(3);

-- The wait between two searches used to double with every fruitless one, which is a
-- curve fitted to nothing: it says a title that has been missing for a week should be
-- looked at less often than one missing for two days, and it says so on the strength of
-- a round counter that a restart or a changed scan interval quietly rewrites. It is a
-- ladder by age now (`SEARCH_BACKOFF_LADDER`), and this column is what it is read off.
--
-- Rows that have already been searched need an age, or the first round after this
-- migration would put every one of them back on the shortest rung and hit every indexer
-- with the whole watchlist at once. There is no record of when each one was first looked
-- for, so it is reconstructed from what does exist: searching cannot have begun before
-- the title was on somebody's list, and cannot have begun before it came out.
--
-- Rows never searched are left null on purpose — that is exactly what null means, and
-- they start their clock at their first empty search like everything else from now on.
UPDATE "WatchlistUnit" u
SET "searchingSince" = GREATEST(w."addedAt", COALESCE(u."airDate", w."addedAt"))
FROM "Watchlist" w
WHERE w."id" = u."watchlistId"
  AND u."lastCheckedAt" IS NOT NULL;
