-- Two answers to the same problem: a primary language of Hungarian means Silo is never
-- downloaded, because it does not exist in Hungarian and the scanner refuses everything
-- else. Until now the only way out was to change the account's whole language order.

-- The account-wide answer, off by default. On, the scanner may take any language on the
-- preferred list rather than only the first one — the scoring already prefers the first,
-- so this widens what is acceptable without changing what is preferred.
ALTER TABLE "User" ADD COLUMN "acceptAnyLanguage" BOOLEAN NOT NULL DEFAULT false;

-- The per-title answer, empty by default. Empty is not "no language": it means the row
-- follows the account, so changing the account still moves every row that never asked
-- for anything special. Only a filled-in value overrules it, and then it overrules
-- everything — including the exclude list.
ALTER TABLE "Watchlist" ADD COLUMN "language" TEXT NOT NULL DEFAULT '';
