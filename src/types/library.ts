import { Media } from "@/types/media";
import { WatchlistDownload } from "@/types/watchlist";

// Mirrors the Prisma LibraryStatus enum so client components don't import the generated client.
export type LibraryStatus = "DOWNLOADING" | "AVAILABLE";

/**
 * One download — one torrent and everything it brought. Seeding and deleting are
 * per torrent, so this is the level the library lists and acts on.
 */
export type LibraryEntry = {
    id: number;
    tmdbId: number;
    type: "movie" | "tv";
    status: LibraryStatus;
    releaseTitle: string;
    // which edition this is. Empty for rows from before downloads had one
    language: string;
    // "S03E07", "S01 — 10 episodes", empty for a film
    covers: string;
    episodeCount: number;
    // how big the torrent is. Null on an old row whose torrent is no longer in the
    // client, which is the only place the size could have been read from
    sizeBytes: number | null;
    startedAt: string;
    completedAt: string | null;
    seedUntil: string | null;
    // still inside the seed window: it can be marked for deletion, not deleted
    seeding: boolean;
    // when the retention will delete it on its own, null while that is switched off
    expiresAt: string | null;
    deleteRequested: boolean;
    deleteFiles: boolean;
    // who was waiting for this, by name. The library is shared; the wanting was not
    watchers: string[];
};

export type LibraryItem = LibraryEntry & {
    media: Media | null;
    // read live from qBittorrent, only present with `?live=1`
    download?: WatchlistDownload | null;
};
