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

export type WatchlistSeasonItem = {
    seasonNumber: number;
    monitored: boolean;
    episodeCount: number;
    downloadedCount: number;
};

// One row of `GET /api/watchlist` — database state plus TMDB metadata.
export type WatchlistItem = WatchlistEntry & {
    media: Media | null;
    addedAt: string;
    seasons: WatchlistSeasonItem[];
};
