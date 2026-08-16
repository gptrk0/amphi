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
    // what this one covers, as `season:episode` keys — empty for a film, one entry for a
    // single episode, all of them for a pack. Keys rather than a sentence: the page groups
    // a title's downloads and has to add these up, and the wording is the reader's
    episodeKeys: string[];
    // how big the torrent is. Null on an old row whose torrent is no longer in the
    // client, which is the only place the size could have been read from
    sizeBytes: number | null;
    startedAt: string;
    completedAt: string | null;
    seedUntil: string | null;
    // still inside the seed window: it can be marked for deletion, not deleted
    seeding: boolean;
    // when the retention will delete it — with its files — on its own. Null while it is
    // still downloading, because there is nothing to count from yet
    expiresAt: string | null;
    // how long it is kept after it finished, in days
    keepDays: number;
    // what that would be if nobody had chosen: 7 for a film or a single episode, 3 per
    // episode of a season pack
    keepDaysDefault: number;
    // somebody chose the number above, rather than it being the default
    keepDaysCustom: boolean;
    deleteRequested: boolean;
    // who was waiting for this, by name. The library is shared; the wanting was not
    watchers: string[];
};

/**
 * What a retention may be set to. The floor is the seed time, which is a setting, so the
 * page is told rather than guessing.
 */
export type KeepRange = { min: number, max: number };

export type LibraryItem = LibraryEntry & {
    media: Media | null;
    // read live from qBittorrent, only present with `?live=1`
    download?: WatchlistDownload | null;
};
