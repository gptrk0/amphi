import { ContentType, WatchStatus as PrismaWatchStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { getMediaMetadata, getTvSeasons } from "@/lib/media";
import { WatchlistEntry, WatchlistItem, WatchStatus } from "@/types/watchlist";

export const watchlistInclude = {
    seasons: {
        orderBy: { seasonNumber: "asc" },
        include: {
            episodes: {
                orderBy: { episodeNumber: "asc" }
            }
        }
    }
} as const;

export const toContentType = (type: string | null): ContentType | null => {
    if (type === "movie") {
        return ContentType.MOVIE;
    } else if (type === "tv") {
        return ContentType.TV;
    }

    return null;
};

export const toMediaType = (type: ContentType): "movie" | "tv" => {
    return type === ContentType.MOVIE ? "movie" : "tv";
};

export const getWatchlist = async () => {
    return await prisma.watchlist.findMany({
        include: watchlistInclude,
        orderBy: { addedAt: "desc" }
    });
};

export const getWatchlistItem = async (id: number) => {
    return await prisma.watchlist.findUnique({
        where: { id },
        include: watchlistInclude
    });
};

export const getWatchlistItemByTmdbId = async (tmdbId: number, type: ContentType) => {
    return await prisma.watchlist.findUnique({
        where: { tmdbId_type: { tmdbId, type } },
        include: watchlistInclude
    });
};

type WatchlistRow = Awaited<ReturnType<typeof getWatchlist>>[number];

/**
 * Monitored episodes plus anything already picked up: an instant download leaves
 * its season unmonitored, and those episodes still have to show their state.
 */
const trackedEpisodes = (item: WatchlistRow) => {
    return item.seasons.flatMap(season => {
        return season.episodes.filter(episode => season.monitored || episode.status !== PrismaWatchStatus.PENDING);
    });
};

/**
 * A show has no single status column — it is derived from its episodes.
 */
export const deriveStatus = (item: WatchlistRow): WatchStatus => {
    if (item.type === ContentType.MOVIE) {
        return item.status;
    }

    const episodes = trackedEpisodes(item);

    if (episodes.length === 0) {
        return PrismaWatchStatus.PENDING;
    }

    if (episodes.every(e => e.status === PrismaWatchStatus.DOWNLOADED)) {
        return PrismaWatchStatus.DOWNLOADED;
    }

    if (episodes.some(e => e.status === PrismaWatchStatus.DOWNLOADING)) {
        return PrismaWatchStatus.DOWNLOADING;
    }

    if (episodes.some(e => e.status === PrismaWatchStatus.SEARCHING)) {
        return PrismaWatchStatus.SEARCHING;
    }

    if (episodes.every(e => e.status === PrismaWatchStatus.FAILED)) {
        return PrismaWatchStatus.FAILED;
    }

    return PrismaWatchStatus.PENDING;
};

export const toWatchlistEntry = (item: WatchlistRow): WatchlistEntry => {
    const episodes = trackedEpisodes(item);

    return {
        id: item.id,
        tmdbId: item.tmdbId,
        type: toMediaType(item.type),
        status: deriveStatus(item),
        episodeCount: item.type === ContentType.MOVIE ? 0 : episodes.length,
        downloadedCount: item.type === ContentType.MOVIE
            ? (item.status === PrismaWatchStatus.DOWNLOADED ? 1 : 0)
            : episodes.filter(e => e.status === PrismaWatchStatus.DOWNLOADED).length
    };
};

export const getWatchlistSlim = async (): Promise<WatchlistEntry[]> => {
    const items = await getWatchlist();

    return items.map(toWatchlistEntry);
};

/**
 * Adds TMDB metadata to a row. On a TMDB failure `media` is null and only the
 * download state is shown.
 */
export const withMedia = async (item: WatchlistRow): Promise<WatchlistItem> => {
    const metadata = await getMediaMetadata(toMediaType(item.type), item.tmdbId);

    return {
        ...toWatchlistEntry(item),
        media: metadata ? metadata.media : null,
        addedAt: item.addedAt.toISOString(),
        seasons: item.seasons.map(season => {
            return {
                seasonNumber: season.seasonNumber,
                monitored: season.monitored,
                episodeCount: season.episodes.length,
                downloadedCount: season.episodes.filter(e => e.status === PrismaWatchStatus.DOWNLOADED).length
            };
        })
    };
};

export const getWatchlistWithMedia = async (): Promise<WatchlistItem[]> => {
    const items = await getWatchlist();

    return await Promise.all(items.map(withMedia));
};

export const getWatchlistItemWithMedia = async (id: number): Promise<WatchlistItem | null> => {
    const item = await getWatchlistItem(id);

    return item ? await withMedia(item) : null;
};

/**
 * Syncs seasons and episodes from TMDB. Existing status and monitored flags are
 * left untouched, so this is safe to run periodically.
 */
export const syncTvSeasons = async (watchlistId: number, tmdbId: number) => {
    const seasons = await getTvSeasons(tmdbId);

    for (const season of seasons) {
        const dbSeason = await prisma.watchlistSeason.upsert({
            where: {
                watchlistId_seasonNumber: {
                    watchlistId,
                    seasonNumber: season.season_number
                }
            },
            update: {},
            create: {
                watchlistId,
                seasonNumber: season.season_number
            }
        });

        for (const episode of season.episodes) {
            const airDate = episode.air_date ? new Date(episode.air_date) : null;

            await prisma.watchlistEpisode.upsert({
                where: {
                    seasonId_episodeNumber: {
                        seasonId: dbSeason.id,
                        episodeNumber: episode.episode_number
                    }
                },
                update: { airDate },
                create: {
                    seasonId: dbSeason.id,
                    episodeNumber: episode.episode_number,
                    airDate
                }
            });
        }
    }

    return seasons.length;
};

/**
 * `monitorSeasons` limits monitoring to the listed seasons: on a fresh row every
 * season starts unmonitored, then only these are turned on. Without it every
 * season is monitored, which is the plain "watch this show" case.
 */
export const addToWatchlist = async (tmdbId: number, type: ContentType, monitorSeasons?: number[]) => {
    // the TMDB lookup doubles as validation of the id
    const metadata = await getMediaMetadata(toMediaType(type), tmdbId);

    if (! metadata) {
        return null;
    }

    const existing = await prisma.watchlist.findUnique({ where: { tmdbId_type: { tmdbId, type } } });

    const item = await prisma.watchlist.upsert({
        where: { tmdbId_type: { tmdbId, type } },
        update: {},
        create: { tmdbId, type }
    });

    if (type === ContentType.TV) {
        await syncTvSeasons(item.id, tmdbId);

        if (monitorSeasons) {
            if (! existing) {
                await setSeasonsMonitored(item.id, false);
            }

            if (monitorSeasons.length > 0) {
                await setSeasonsMonitored(item.id, true, monitorSeasons);
            }
        }
    }

    return await getWatchlistItemWithMedia(item.id);
};

export const removeFromWatchlist = async (id: number) => {
    return await prisma.watchlist.delete({ where: { id } });
};

export const getSeasonEpisodes = async (watchlistId: number, seasonNumber: number) => {
    return await prisma.watchlistEpisode.findMany({
        where: { season: { watchlistId, seasonNumber } },
        orderBy: { episodeNumber: "asc" }
    });
};

export const markMovieDownloading = async (watchlistId: number, torrentHash: string | null) => {
    return await prisma.watchlist.update({
        where: { id: watchlistId },
        data: {
            status: PrismaWatchStatus.DOWNLOADING,
            torrentHash,
            searchAttempts: 0,
            lastCheckedAt: new Date()
        }
    });
};

export const markEpisodesDownloading = async (episodeIds: number[], torrentHash: string | null) => {
    return await prisma.watchlistEpisode.updateMany({
        where: { id: { in: episodeIds } },
        data: {
            status: PrismaWatchStatus.DOWNLOADING,
            torrentHash,
            searchAttempts: 0,
            lastCheckedAt: new Date()
        }
    });
};

export const setSeasonsMonitored = async (watchlistId: number, monitored: boolean, seasonNumbers?: number[]) => {
    return await prisma.watchlistSeason.updateMany({
        where: {
            watchlistId,
            ...(seasonNumbers ? { seasonNumber: { in: seasonNumbers } } : {})
        },
        data: { monitored }
    });
};

export const setSeasonMonitored = async (watchlistId: number, seasonNumber: number, monitored: boolean) => {
    return await prisma.watchlistSeason.update({
        where: {
            watchlistId_seasonNumber: { watchlistId, seasonNumber }
        },
        data: { monitored }
    });
};
