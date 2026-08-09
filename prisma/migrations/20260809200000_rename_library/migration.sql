-- "Item" said nothing the table did not: it is the library, one row per download.
ALTER TABLE "LibraryItem" RENAME TO "Library";

ALTER TABLE "Library" RENAME CONSTRAINT "LibraryItem_pkey" TO "Library_pkey";
ALTER SEQUENCE "LibraryItem_id_seq" RENAME TO "Library_id_seq";

ALTER INDEX "LibraryItem_tmdbId_type_idx" RENAME TO "Library_tmdbId_type_idx";
ALTER INDEX "LibraryItem_torrentHash_idx" RENAME TO "Library_torrentHash_idx";
ALTER INDEX "LibraryItem_status_idx" RENAME TO "Library_status_idx";
