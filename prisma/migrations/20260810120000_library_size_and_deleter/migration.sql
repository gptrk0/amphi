-- Two things the library listing could not say: how big a download is, and whose
-- decision it was to delete it.

-- Null on every existing row, and it stays null until the next round reads the client
-- back — the size is qBittorrent's answer, and there is nothing in the database to
-- derive it from. A row whose torrent is already gone keeps a dash in the size column,
-- which is the honest answer for it.
ALTER TABLE "Library" ADD COLUMN "sizeBytes" DOUBLE PRECISION;

-- The mark and the deletion are minutes or days apart, and by the time the cleanup runs
-- there is nobody signed in to name. Deliberately not a foreign key: the account may be
-- deleted before the seed time is up, and that must not take the mark with it — a name
-- that cannot be looked up any more simply drops out of the message.
ALTER TABLE "Library" ADD COLUMN "deleteRequestedBy" INTEGER;
