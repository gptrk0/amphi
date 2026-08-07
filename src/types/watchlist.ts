import { Media } from "@/types/media";

// Mirrors the Prisma WatchStatus enum so client components don't import the generated client.
export type WatchStatus = "PENDING" | "SEARCHING" | "DOWNLOADING" | "DOWNLOADED" | "FAILED";

// One row of `GET /api/watchlist?slim=1` — built without any TMDB call.
export type WatchlistEntry = {
    id: number;
    tmdbId: number;
    type: "movie" | "tv";
    status: WatchStatus;
    episodeCount: number;
    downloadedCount: number;
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
