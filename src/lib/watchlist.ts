import { ContentType, Prisma, WatchStatus as PrismaWatchStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { getMediaMetadata, getTvSeasons } from "@/lib/media";
import { removeTorrent, TorrentStatus } from "@/lib/torrent";
import { WatchlistDownload, WatchlistEntry, WatchlistItem, WatchlistSeasonItem, WatchStatus } from "@/types/watchlist";

export const watchlistInclude = {
    units: {
        orderBy: [
            { seasonNumber: "asc" },
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
type UnitRow = WatchlistRow["units"][number];

/**
 * Monitored units plus anything already picked up: an instant download leaves its
 * season unmonitored, and those episodes still have to show their state.
 */
const trackedUnits = (item: WatchlistRow) => {
    return item.units.filter(unit => unit.monitored || unit.status !== PrismaWatchStatus.PENDING);
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
        downloadedCount: units.filter(unit => unit.status === PrismaWatchStatus.DOWNLOADED).length,
        monitored: item.units.some(unit => unit.monitored)
    };
};

export const getWatchlistSlim = async (): Promise<WatchlistEntry[]> => {
    const items = await getWatchlist();

    return items.map(toWatchlistEntry);
};

/**
 * Seasons are not stored, they are read back from the units that carry the number.
 */
const toSeasons = (units: UnitRow[], withEpisodes: boolean): WatchlistSeasonItem[] => {
    const grouped = new Map<number, UnitRow[]>();

    for (const unit of units) {
        if (unit.seasonNumber === null) {
            continue;
        }

        grouped.set(unit.seasonNumber, [ ...(grouped.get(unit.seasonNumber) || []), unit ]);
    }

    return [ ...grouped.entries() ]
        .sort(([ a ], [ b ]) => a - b)
        .map(([ seasonNumber, seasonUnits ]) => ({
            seasonNumber,
            monitored: seasonUnits.some(unit => unit.monitored),
            episodeCount: seasonUnits.length,
            downloadedCount: seasonUnits.filter(unit => unit.status === PrismaWatchStatus.DOWNLOADED).length,
            ...(withEpisodes ? {
                episodes: seasonUnits
                    .filter(unit => unit.episodeNumber !== null)
                    .map(unit => ({
                        episodeNumber: unit.episodeNumber as number,
                        monitored: unit.monitored,
                        status: unit.status,
                        airDate: unit.airDate ? unit.airDate.toISOString() : null
                    }))
            } : {})
        }));
};

/**
 * Adds TMDB metadata to a row. On a TMDB failure `media` is null and only the
 * download state is shown.
 */
export const withMedia = async (item: WatchlistRow, withEpisodes = false): Promise<WatchlistItem> => {
    const metadata = await getMediaMetadata(toMediaType(item.type), item.tmdbId);
    const units = trackedUnits(item);
    const checked = units.map(unit => unit.lastCheckedAt).filter((v): v is Date => !! v);

    return {
        ...toWatchlistEntry(item),
        media: metadata ? metadata.media : null,
        addedAt: item.addedAt.toISOString(),
        lastCheckedAt: checked.length > 0 ? new Date(Math.max(...checked.map(v => v.getTime()))).toISOString() : null,
        searchAttempts: units.reduce((max, unit) => Math.max(max, unit.searchAttempts), 0),
        seasons: toSeasons(item.units, withEpisodes)
    };
};

/**
 * The live state of whatever the item is downloading. A season pack is one torrent
 * for many units, several single episodes are several torrents — hence the sums.
 */
const toDownload = (units: UnitRow[], byHash: Map<string, TorrentStatus>): WatchlistDownload | null => {
    const hashes = [ ...new Set(units
        .filter(unit => unit.status === PrismaWatchStatus.DOWNLOADING && unit.torrentHash)
        .map(unit => String(unit.torrentHash).toLowerCase())) ];

    const torrents = hashes.map(hash => byHash.get(hash)).filter((v): v is TorrentStatus => !! v);

    if (torrents.length === 0) {
        return null;
    }

    return {
        name: torrents.length === 1 ? torrents[0].name : `${ torrents.length } torrents`,
        state: torrents.length === 1 ? torrents[0].state : "downloading",
        progress: torrents.reduce((sum, t) => sum + t.progress, 0) / torrents.length,
        downloadSpeed: torrents.reduce((sum, t) => sum + t.downloadSpeed, 0),
        // the slowest one decides when the item is done
        eta: torrents.some(t => t.eta === null) ? null : Math.max(...torrents.map(t => t.eta as number)),
        size: torrents.reduce((sum, t) => sum + t.size, 0)
    };
};

/**
 * With `torrents` the live qBittorrent state is joined onto the rows; the caller
 * fetches it once for the whole table and can hand the same list to the download
 * sync. Null means the client is not asked at all.
 */
export const getWatchlistWithMedia = async (torrents: TorrentStatus[] | null = null): Promise<WatchlistItem[]> => {
    const items = await getWatchlist();
    const live = torrents !== null;
    const byHash = new Map((torrents || []).map(torrent => [ torrent.hash.toLowerCase(), torrent ]));

    return await Promise.all(items.map(async item => {
        const dto = await withMedia(item);

        return live ? { ...dto, download: toDownload(item.units, byHash) } : dto;
    }));
};

export const getWatchlistItemWithMedia = async (id: number): Promise<WatchlistItem | null> => {
    const item = await getWatchlistItem(id);

    return item ? await withMedia(item, true) : null;
};

export const toAirDate = (date: string | null | undefined) => date ? new Date(date) : null;

/**
 * A movie is a single unit. A null season and a null episode never collide in a
 * unique index, so that "single" is kept here rather than by the database.
 *
 * `airDate` is the release date and means the same as it does on an episode: the
 * scanner does not search before it. TMDB moves release dates around, so a known
 * one always overwrites what is stored.
 */
export const ensureMovieUnit = async (watchlistId: number, airDate: Date | null = null) => {
    const existing = await prisma.watchlistUnit.findFirst({ where: { watchlistId } });

    if (! existing) {
        return await prisma.watchlistUnit.create({ data: { watchlistId, airDate } });
    }

    if (airDate && existing.airDate?.getTime() !== airDate.getTime()) {
        return await prisma.watchlistUnit.update({ where: { id: existing.id }, data: { airDate } });
    }

    return existing;
};

/**
 * A new episode follows its own season, and a season the show has never had follows
 * the latest one it does. Defaulting to monitored instead would start watching a
 * show that was only ever grabbed once.
 */
const inheritedMonitored = async (watchlistId: number, seasonNumber: number) => {
    const own = await prisma.watchlistUnit.findFirst({ where: { watchlistId, seasonNumber } });

    if (own) {
        return own.monitored;
    }

    const latest = await prisma.watchlistUnit.findFirst({
        where: { watchlistId, seasonNumber: { not: null } },
        orderBy: { seasonNumber: "desc" }
    });

    return latest ? latest.monitored : true;
};

/**
 * Syncs episode units from TMDB. Existing status and monitored flags are left
 * untouched, so this is safe to run periodically.
 */
export const syncTvSeasons = async (watchlistId: number, tmdbId: number) => {
    const seasons = await getTvSeasons(tmdbId);

    for (const season of seasons) {
        const monitored = await inheritedMonitored(watchlistId, season.season_number);

        for (const episode of season.episodes) {
            const airDate = episode.air_date ? new Date(episode.air_date) : null;

            await prisma.watchlistUnit.upsert({
                where: {
                    watchlistId_seasonNumber_episodeNumber: {
                        watchlistId,
                        seasonNumber: season.season_number,
                        episodeNumber: episode.episode_number
                    }
                },
                update: { airDate },
                create: {
                    watchlistId,
                    seasonNumber: season.season_number,
                    episodeNumber: episode.episode_number,
                    airDate,
                    monitored
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
        await ensureMovieUnit(item.id, toAirDate(metadata.media.date));

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

/**
 * Not watched and not on disk. A forgotten unit is deliberately left as if it had
 * never been grabbed, so the scanner does not fetch it all over again.
 */
const FORGOTTEN = {
    monitored: false,
    status: PrismaWatchStatus.PENDING,
    torrentHash: null
};

/**
 * Stop watching. Nothing is removed from the torrent client, so an item that has
 * something downloaded survives this and stays listed under Downloaded — only one
 * with nothing to show for itself is pruned away.
 */
export const stopWatching = async (id: number) => {
    await prisma.watchlistUnit.updateMany({ where: { watchlistId: id }, data: { monitored: false } });

    return await pruneWatchlistItem(id);
};

/**
 * Delete. The torrents go from the client too, with or without their files, and
 * every unit is forgotten so that nothing is downloaded a second time.
 */
export const deleteItem = async (id: number, deleteFiles: boolean) => {
    const units = await prisma.watchlistUnit.findMany({ where: { watchlistId: id, torrentHash: { not: null } } });

    for (const hash of new Set(units.map(unit => String(unit.torrentHash)))) {
        await removeTorrent(hash, deleteFiles);
    }

    await prisma.watchlistUnit.updateMany({ where: { watchlistId: id }, data: FORGOTTEN });

    return await pruneWatchlistItem(id);
};

/**
 * The torrent of something already downloaded is no longer in the client, which
 * means it was watched and cleaned up — not a failure worth retrying.
 */
export const forgetUnits = async (ids: number[]) => {
    return await prisma.watchlistUnit.updateMany({ where: { id: { in: ids } }, data: FORGOTTEN });
};

export const getMovieUnit = async (watchlistId: number) => {
    return await prisma.watchlistUnit.findFirst({ where: { watchlistId, seasonNumber: null } });
};

export const getSeasonUnits = async (watchlistId: number, seasonNumber: number) => {
    return await prisma.watchlistUnit.findMany({
        where: { watchlistId, seasonNumber },
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

/**
 * Episode units only — a movie has no season and is never monitored by season.
 */
export const setSeasonsMonitored = async (watchlistId: number, monitored: boolean, seasonNumbers?: number[]) => {
    return await prisma.watchlistUnit.updateMany({
        where: {
            watchlistId,
            seasonNumber: seasonNumbers ? { in: seasonNumbers } : { not: null }
        },
        data: { monitored }
    });
};

/**
 * A search that came back empty is bookkeeping, not a possession: once a unit is
 * not watched any more, its SEARCHING or FAILED state is about a search nobody
 * asked for. Clearing it is what lets the row be pruned — otherwise the very
 * scanning that a title needs while it waits for a release is what keeps it stuck
 * on the watchlist.
 */
const clearIdleSearches = async (watchlistId: number) => {
    return await prisma.watchlistUnit.updateMany({
        where: {
            watchlistId,
            monitored: false,
            status: { in: [ PrismaWatchStatus.SEARCHING, PrismaWatchStatus.FAILED ] }
        },
        data: {
            status: PrismaWatchStatus.PENDING,
            torrentHash: null,
            searchAttempts: 0,
            lastCheckedAt: null
        }
    });
};

/**
 * A show nobody watches and nothing was downloaded from has no reason to sit on the
 * watchlist — unchecking the last episode has to take the row with it. Only a real
 * download counts as something to keep it for; a status left over from searching
 * does not.
 */
export const pruneWatchlistItem = async (id: number): Promise<WatchlistItem | null> => {
    await clearIdleSearches(id);

    const keep = await prisma.watchlistUnit.count({
        where: {
            watchlistId: id,
            OR: [
                { monitored: true },
                { status: { in: [ PrismaWatchStatus.DOWNLOADING, PrismaWatchStatus.DOWNLOADED ] } }
            ]
        }
    });

    if (keep > 0) {
        return await getWatchlistItemWithMedia(id);
    }

    await removeFromWatchlist(id);

    return null;
};

/**
 * The checkbox on the details page writes straight through: ticking something puts
 * the show on the watchlist if it is not there yet, unticking the last thing takes
 * it off again. Without `episodeNumbers` the whole season is meant.
 */
export const setMonitored = async (
    tmdbId: number,
    type: ContentType,
    monitored: boolean,
    target: { seasonNumber?: number, episodeNumbers?: number[] } = {}
): Promise<WatchlistItem | null> => {
    let row = await prisma.watchlist.findUnique({ where: { tmdbId_type: { tmdbId, type } } });

    if (! row) {
        if (! monitored) {
            return null;
        }

        // added with nothing monitored; only the requested part is turned on below
        const created = await addToWatchlist(tmdbId, type, []);

        if (! created) {
            return null;
        }

        row = await prisma.watchlist.findUnique({ where: { id: created.id } });
    }

    if (! row) {
        return null;
    }

    await prisma.watchlistUnit.updateMany({
        where: {
            watchlistId: row.id,
            seasonNumber: target.seasonNumber ?? { not: null },
            ...(target.episodeNumbers ? { episodeNumber: { in: target.episodeNumbers } } : {})
        },
        data: { monitored }
    });

    return await pruneWatchlistItem(row.id);
};
