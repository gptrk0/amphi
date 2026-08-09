-- The language rules move from the install to the person, and a download starts saying
-- which edition it is.

ALTER TABLE "User"
    ADD COLUMN "preferredLanguages" TEXT NOT NULL DEFAULT 'hun,eng',
    ADD COLUMN "excludeLanguages" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "defaultLanguage" TEXT NOT NULL DEFAULT 'eng',
    ADD COLUMN "languageBonus" INTEGER NOT NULL DEFAULT 1000000,
    ADD COLUMN "languageFirst" BOOLEAN NOT NULL DEFAULT false;

-- whatever the install was set to until now becomes everybody's starting point, so
-- nothing changes on the day this lands. A key with no row was on its registry default,
-- which is what the column default already is.
UPDATE "User" SET
    "preferredLanguages" = COALESCE((SELECT "value" FROM "Setting" WHERE "key" = 'QUALITY_PREFERRED_LANGUAGES'), "preferredLanguages"),
    "excludeLanguages"   = COALESCE((SELECT "value" FROM "Setting" WHERE "key" = 'QUALITY_EXCLUDE_LANGUAGES'), "excludeLanguages"),
    "defaultLanguage"    = COALESCE((SELECT "value" FROM "Setting" WHERE "key" = 'QUALITY_DEFAULT_LANGUAGE'), "defaultLanguage"),
    -- guarded rather than cast: a value that is not a plain number would abort the whole
    -- migration, and Prisma then marks it failed and refuses every later one until
    -- somebody resolves it by hand. Measured: `1e6` in that row was enough to stop a
    -- container from ever starting. Anything unreadable falls back to the default.
    "languageBonus"      = COALESCE((SELECT CASE WHEN "value" ~ '^[0-9]+$' THEN "value"::INTEGER END FROM "Setting" WHERE "key" = 'QUALITY_LANGUAGE_BONUS'), "languageBonus"),
    "languageFirst"      = COALESCE((SELECT "value" IN ('1', 'true') FROM "Setting" WHERE "key" = 'QUALITY_LANGUAGE_FIRST'), "languageFirst");

-- the settings page no longer offers these, and a row nothing reads is a row that will
-- disagree with the truth one day
DELETE FROM "Setting" WHERE "key" IN (
    'QUALITY_PREFERRED_LANGUAGES',
    'QUALITY_EXCLUDE_LANGUAGES',
    'QUALITY_DEFAULT_LANGUAGE',
    'QUALITY_LANGUAGE_BONUS',
    'QUALITY_LANGUAGE_FIRST'
);

-- Empty is the answer for everything downloaded so far: it was fetched under one set of
-- rules for the whole house, so it counts for everybody rather than for nobody.
ALTER TABLE "Library" ADD COLUMN "language" TEXT NOT NULL DEFAULT '';
