-- Two weights that could not be set well, because there was nothing to set them against:
-- "what does 100000 mean?" has no answer without every other number in the formula. The
-- scoring is strict tiers now — see the note above `score` in src/lib/release.ts — so the
-- preferred indexer always wins at equal quality, and a preferred language always wins.

-- The install-wide one first. Nothing reads the key any more, and a row nothing reads is
-- one that will disagree with the truth one day.
DELETE FROM "Setting" WHERE "key" = 'INDEXER_PRIORITY_BONUS';

-- "Language outranks resolution" starts on: wanting a language means wanting to
-- understand the film, and a sharper copy in a language you do not speak is not a better
-- one. Off stays available, as a decision.
ALTER TABLE "User" ALTER COLUMN "languageFirst" SET DEFAULT true;

-- Existing rows follow. The column shipped on 2026-08-09 with `false` as its default and
-- nothing on the account page pointed at it, so a `false` here is the old default rather
-- than anybody's answer — measured before writing this: every row was at the untouched
-- pair (false, 1000000). Somebody who wants the sharpest copy can turn it back off, and
-- from then on this migration will not exist any more to overrule them.
UPDATE "User" SET "languageFirst" = true;

-- And the weight itself. It was per person and its default was 1000000, a number whose
-- only job was to be bigger than a seeder count.
ALTER TABLE "User" DROP COLUMN "languageBonus";
