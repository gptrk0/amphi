import { ContentType, Prisma, WatchStatus as PrismaWatchStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { getMediaMetadata, getTvSeasons } from "@/lib/media";
import { WatchlistEntry, WatchlistItem, WatchStatus } from "@/types/watchlist";

export const watchlistInclude = {
    seasons: {
        orderBy: { seasonNumber: "asc" }
    },
    units: {
        orderBy: [
            { season: { seasonNumber: "asc" } },
            { episodeNumber: "asc" }
        ]
    }
} satisfies Prisma.WatchlistInclude;

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
 * Monitored units plus anything already picked up: an instant download leaves its
 * season unmonitored, and those episodes still have to show their state. A movie
 * has no season, so its single unit is always tracked.
 */
const trackedUnits = (item: WatchlistRow) => {
    const monitored = new Map(item.seasons.map(season => [ season.id, season.monitored ]));

    return item.units.filter(unit => {
        return unit.seasonId === null || monitored.get(unit.seasonId) || unit.status !== PrismaWatchStatus.PENDING;
    });
};

/**
 * No item has a status column of its own — it is as far along as its units. A movie
 * has exactly one, so this returns that unit's status unchanged.
 */
export const deriveStatus = (item: WatchlistRow): WatchStatus => {
    const units = trackedUnits(item);

    if (units.length === 0) {
        return PrismaWatchStatus.PENDING;
    }

    if (units.every(u => u.status === PrismaWatchStatus.DOWNLOADED)) {
        return PrismaWatchStatus.DOWNLOADED;
    }

    if (units.some(u => u.status === PrismaWatchStatus.DOWNLOADING)) {
        return PrismaWatchStatus.DOWNLOADING;
    }

    if (units.some(u => u.status === PrismaWatchStatus.SEARCHING)) {
        return PrismaWatchStatus.SEARCHING;
    }

    if (units.every(u => u.status === PrismaWatchStatus.FAILED)) {
        return PrismaWatchStatus.FAILED;
    }

    return PrismaWatchStatus.PENDING;
};

export const toWatchlistEntry = (item: WatchlistRow): WatchlistEntry => {
    const units = trackedUnits(item);

    return {
        id: item.id,
        tmdbId: item.tmdbId,
        type: toMediaType(item.type),
        status: deriveStatus(item),
        episodeCount: units.filter(unit => unit.episodeNumber !== null).length,
        downloadedCount: units.filter(unit => unit.status === PrismaWatchStatus.DOWNLOADED).length
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
            const units = item.units.filter(unit => unit.seasonId === season.id);

            return {
                seasonNumber: season.seasonNumber,
                monitored: season.monitored,
                episodeCount: units.length,
                downloadedCount: units.filter(unit => unit.status === PrismaWatchStatus.DOWNLOADED).length
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
 * A movie is a single unit. A null season and a null episode never collide in a
 * unique index, so that "single" is kept here rather than by the database.
 */
export const ensureMovieUnit = async (watchlistId: number) => {
    const existing = await prisma.watchlistUnit.findFirst({ where: { watchlistId } });

    return existing || await prisma.watchlistUnit.create({ data: { watchlistId } });
};

/**
 * Syncs seasons and episode units from TMDB. Existing status and monitored flags
 * are left untouched, so this is safe to run periodically.
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

            await prisma.watchlistUnit.upsert({
                where: {
                    seasonId_episodeNumber: {
                        seasonId: dbSeason.id,
                        episodeNumber: episode.episode_number
                    }
                },
                update: { airDate },
                create: {
                    watchlistId,
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

    if (type === ContentType.MOVIE) {
        await ensureMovieUnit(item.id);

    } else {
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

export const getMovieUnit = async (watchlistId: number) => {
    return await prisma.watchlistUnit.findFirst({ where: { watchlistId, seasonId: null } });
};

export const getSeasonUnits = async (watchlistId: number, seasonNumber: number) => {
    return await prisma.watchlistUnit.findMany({
        where: { watchlistId, season: { seasonNumber } },
        orderBy: { episodeNumber: "asc" }
    });
};

/**
 * One call for both kinds: a movie hands in its single unit, a season pack hands in
 * every unit the one torrent covers.
 */
export const markUnitsDownloading = async (unitIds: number[], torrentHash: string | null) => {
    return await prisma.watchlistUnit.updateMany({
        where: { id: { in: unitIds } },
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
