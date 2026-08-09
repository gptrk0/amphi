-- One download covers a handful of episodes and every question about them is asked
-- about a single title, so the child table only ever got read whole and collapsed
-- back into a set of keys. The keys are what the code wanted; store those.
ALTER TABLE "LibraryItem" ADD COLUMN "episodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "LibraryItem" SET "episodes" = coalesce((
    SELECT array_agg(e."seasonNumber" || ':' || e."episodeNumber" ORDER BY e."seasonNumber", e."episodeNumber")
    FROM "LibraryEpisode" e
    WHERE e."itemId" = "LibraryItem"."id"
), ARRAY[]::TEXT[]);

DROP TABLE "LibraryEpisode";
