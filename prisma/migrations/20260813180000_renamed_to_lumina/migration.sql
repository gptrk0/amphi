-- The app was renamed from aioseerr to Lumina, and one of the old name's copies is not in
-- the code at all: the qBittorrent category. Its default in the settings registry moved
-- from `aioseerr` to `lumina`, and a default is what an install with no row for that key
-- uses — so on an existing install the rename would silently point the scanner at a
-- category that does not exist. Every torrent it manages would read as "gone from the
-- client", and a download that is gone from the client is put back on the watchlist and
-- searched for again.
--
-- So the old value is written down as what it always was: a decision. Only where nobody
-- has made one explicitly — an install that already names its own category keeps it, and
-- a fresh install has no rows at all and gets `lumina` from the registry.
--
-- To finish the rename later: rename the category in qBittorrent (Torrents → right click →
-- Category → Edit), then press reset next to Category on the settings page. That deletes
-- this row and the registry default takes over again.
INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT 'TORRENT_CATEGORY', 'aioseerr', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'TORRENT_CATEGORY')
  -- and only for a database that predates the rename. A fresh install runs every migration
  -- in order before it is ever used, and it must not inherit the old name from history
  AND EXISTS (SELECT 1 FROM "User");
