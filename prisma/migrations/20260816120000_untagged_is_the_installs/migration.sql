-- What an untagged release counts as goes back to the admin page. It was one of the five
-- language settings that became personal on 2026-08-09, and it was the one that never
-- belonged there: the other four say what somebody wants, this one says what a file *is*.
-- Two accounts cannot each be right about that, and nothing in the app ever asked the
-- question per person — every reader of it wanted one answer.
--
-- The install-wide value is taken from what the accounts already say, so nobody's searches
-- change shape on the way through this migration. Accounts that disagreed are decided by
-- the majority, ties alphabetically; nothing is written when the answer is the setting's
-- own default, so the row stays "not edited" on an install that never touched it.
INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT 'QUALITY_UNTAGGED_LANGUAGE', agreed."chosen", now()
FROM (
    SELECT "defaultLanguage" AS "chosen"
    FROM "User"
    GROUP BY "defaultLanguage"
    ORDER BY count(*) DESC, "defaultLanguage"
    LIMIT 1
) AS agreed
WHERE agreed."chosen" <> 'eng'
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "User" DROP COLUMN "defaultLanguage";
