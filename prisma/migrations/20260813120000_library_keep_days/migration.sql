-- The retention stops being one number for the whole install and becomes a property of
-- the download, editable in the library. And a deletion stops asking about the files.

-- Null on every existing row, which is the point: null means "the default for this row's
-- shape" — five days for a film, three per episode for a series, never under the seed
-- time and never over 60 days. Filling it in here would freeze today's rule into rows
-- that should follow it, and the numbers are computed on read anyway (`keepDays` in
-- src/lib/library.ts).
ALTER TABLE "Library" ADD COLUMN "keepDays" INTEGER;

-- Every deletion takes the files with it now — the mark that stood on a seeding row had a
-- files-or-not answer stored on it, and there is no longer a question to answer. Keeping
-- the row without the files was always the worst of the two: nothing in the app knows
-- about them any more, and the disk is exactly as full as it was.
ALTER TABLE "Library" DROP COLUMN "deleteFiles";

-- And the install-wide retention is gone. Nothing reads the key, and a row nothing reads
-- is one that will disagree with the truth one day.
DELETE FROM "Setting" WHERE "key" = 'LIBRARY_RETENTION_DAYS';
