import { Media } from "@/types/media";

// Mirrors the Prisma WatchStatus enum so client components don't import the generated client.
export type WatchStatus = "PENDING" | "SEARCHING" | "DOWNLOADING" | "DOWNLOADED" | "FAILED";

/**
 * The status of a whole item, which is derived and never stored — so it can say one
 * thing the units cannot. `UPCOMING` is "nothing to look for yet": every part still
 * wanted airs in the future, and the scanner deliberately leaves those alone. Without
 * it such an item read as plain `PENDING`, and the table's "never checked" looked like
 * a broken scanner rather than the hold back it is.
 */
export type WatchlistStatus = WatchStatus | "UPCOMING";

// One row of `GET /api/watchlist?slim=1` — built without any TMDB call.
export type WatchlistEntry = {
    id: number;
    tmdbId: number;
    type: "movie" | "tv";
    status: WatchlistStatus;
    // when the next part still wanted airs, null once nothing is waiting on a date
    nextAirDate: string | null;
    episodeCount: number;
    downloadedCount: number;
    // being watched and being on disk are separate: something downloaded stays
    // listed under Downloaded after you stop watching it
    monitored: boolean;
};

export type WatchlistEpisodeItem = {
    episodeNumber: number;
    monitored: boolean;
    status: WatchStatus;
    airDate: string | null;
};

// `episodes` is only filled by the single item endpoint — the list would carry every
// episode of every show for nothing.
export type WatchlistSeasonItem = {
    seasonNumber: number;
    monitored: boolean;
    episodeCount: number;
    downloadedCount: number;
    episodes?: WatchlistEpisodeItem[];
};

// Read live from qBittorrent, never stored — a percentage is stale the moment it
// would be written. Only present with `?live=1`.
export type WatchlistDownload = {
    name: string;
    state: string;
    progress: number;
    downloadSpeed: number;
    eta: number | null;
    size: number;
};

// One row of `GET /api/watchlist` — database state plus TMDB metadata.
export type WatchlistItem = WatchlistEntry & {
    media: Media | null;
    addedAt: string;
    // the latest of the units, so a show shows when it was last looked for
    lastCheckedAt: string | null;
    searchAttempts: number;
    seasons: WatchlistSeasonItem[];
    download?: WatchlistDownload | null;
};
