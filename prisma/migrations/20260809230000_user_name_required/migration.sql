-- A name is not optional any more: it is what every log line that names somebody
-- prints, and an email address there reads like a machine did the deleting.
--
-- Nothing to backfill — the column is already NOT NULL, only its default goes, so an
-- insert without a name now fails instead of quietly storing an empty string.
UPDATE "User" SET "name" = split_part("email", '@', 1) WHERE "name" = '';

ALTER TABLE "User" ALTER COLUMN "name" DROP DEFAULT;
