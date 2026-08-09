import { ContentType, Prisma, WatchStatus as PrismaWatchStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { getMediaMetadata, getTvSeasons } from "@/lib/media";
import { removeTorrent, TorrentStatus } from "@/lib/torrent";
import { WatchlistDownload, WatchlistEntry, WatchlistItem, WatchlistSeasonItem, WatchlistStatus } from "@/types/watchlist";

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
 * Units that are still to be obtained. What is left once these run out is either on
 * disk or was given up on.
 */
const outstandingUnits = (units: UnitRow[]) => units.filter(unit => unit.status === PrismaWatchStatus.PENDING);

// an unknown date does not hold anything back — the scanner searches those
const airsLater = (airDate: Date | null) => !! airDate && airDate.getTime() > Date.now();

/**
 * The earliest date something still wanted is waiting for, which is what makes
 * `UPCOMING` explainable instead of just "nothing is happening".
 */
const nextAirDate = (units: UnitRow[]): string | null => {
    const dates = outstandingUnits(units)
        .map(unit => unit.airDate)
        .filter((date): date is Date => airsLater(date))
        .map(date => date.getTime());

    return dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : null;
};

/**
 * No item has a status column of its own — it is as far along as its units. A movie
 * has exactly one, so this returns that unit's status unchanged.
 */
export const deriveStatus = (item: WatchlistRow): WatchlistStatus => {
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

    // Nothing is being looked for, and nothing can be: every part still wanted airs
    // later. This also covers a show you are up to date on — the downloaded episodes
    // are behind us, the next one is not out yet.
    const outstanding = outstandingUnits(units);

    if (outstanding.length > 0 && outstanding.every(unit => airsLater(unit.airDate))) {
        return "UPCOMING";
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
        nextAirDate: nextAirDate(units),
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
 * A unit is stored for something that is watched or something that is already had.
 * Nothing else: a show's full episode list belongs to TMDB, and mirroring it into
 * rows only to leave them untouched made every season of every show a table's worth
 * of writes on each refresh round.
 *
 * The consequence to keep in mind: an episode with no row is not "unknown", it is
 * "not wanted". The pages read the episode list from TMDB and look the state up
 * here, so a missing row draws as an unticked, stateless line.
 */
export const ensureEpisodeUnits = async (
    watchlistId: number,
    tmdbId: number,
    seasonNumber: number,
    episodeNumbers: number[],
    monitored = false
) => {
    const season = (await getTvSeasons(tmdbId)).find(v => v.season_number === seasonNumber);
    const units = [];

    for (const episodeNumber of episodeNumbers) {
        const episode = season?.episodes.find(v => v.episode_number === episodeNumber);

        units.push(await prisma.watchlistUnit.upsert({
            where: {
                watchlistId_seasonNumber_episodeNumber: { watchlistId, seasonNumber, episodeNumber }
            },
            // turning monitoring on may find the row already there from a download;
            // turning it off is never this function's job, so `false` leaves it alone
            update: {
                airDate: toAirDate(episode?.air_date),
                ...(monitored ? { monitored: true } : {})
            },
            create: {
                watchlistId,
                seasonNumber,
                episodeNumber,
                airDate: toAirDate(episode?.air_date),
                monitored
            }
        }));
    }

    return units;
};

/**
 * Whole seasons at once. Without `seasonNumbers` every season the show has.
 */
export const ensureSeasonUnits = async (
    watchlistId: number,
    tmdbId: number,
    seasonNumbers?: number[],
    monitored = false
) => {
    const seasons = (await getTvSeasons(tmdbId))
        .filter(season => ! seasonNumbers || seasonNumbers.includes(season.season_number));

    const units = [];

    for (const season of seasons) {
        units.push(...await ensureEpisodeUnits(
            watchlistId,
            tmdbId,
            season.season_number,
            season.episodes.map(episode => episode.episode_number),
            monitored
        ));
    }

    return units;
};

/**
 * Follows TMDB for what is stored: the air dates of the rows that exist, and the
 * new episodes of a season that is watched. A season nobody watches gets no rows at
 * all, so this is cheap to run periodically — the whole point of it is the air
 * dates, which TMDB keeps moving and the scanner holds unreleased units back by.
 *
 * A season with no rows is only taken up if the show itself is watched
 * (`monitorNewSeasons`) and the season is newer than anything stored — a season
 * below that was offered once and is not there because it was not picked.
 */
export const syncTvSeasons = async (watchlistId: number, tmdbId: number) => {
    const seasons = await getTvSeasons(tmdbId);
    const item = await prisma.watchlist.findUnique({ where: { id: watchlistId } });
    const units = await prisma.watchlistUnit.findMany({ where: { watchlistId, seasonNumber: { not: null } } });

    const known = units.map(unit => unit.seasonNumber as number);
    const latest = known.length > 0 ? Math.max(...known) : null;

    for (const season of seasons) {
        const own = units.filter(unit => unit.seasonNumber === season.season_number);

        const watched = own.length > 0
            ? own.some(unit => unit.monitored)
            : !! item?.monitorNewSeasons && (latest === null || season.season_number > latest);

        // A watched season picks up what is announced above it, never what sits
        // below: with no rows for the unwanted, "not stored" and "declined" look the
        // same, and the episode number is what tells them apart. Watching a show from
        // its fourth episode on must not silently become watching all four.
        const highest = own.length > 0 ? Math.max(...own.map(unit => unit.episodeNumber as number)) : null;

        for (const episode of season.episodes) {
            const stored = own.find(unit => unit.episodeNumber === episode.episode_number);
            const airDate = toAirDate(episode.air_date);

            if (stored) {
                // the flags are never touched here: an episode unticked one by one
                // must not be turned back on by a metadata round
                if (stored.airDate?.getTime() !== airDate?.getTime()) {
                    await prisma.watchlistUnit.update({ where: { id: stored.id }, data: { airDate } });
                }

                continue;
            }

            if (watched && (highest === null || episode.episode_number > highest)) {
                await prisma.watchlistUnit.create({
                    data: {
                        watchlistId,
                        seasonNumber: season.season_number,
                        episodeNumber: episode.episode_number,
                        airDate,
                        monitored: true
                    }
                });
            }
        }
    }

    return seasons.length;
};

/**
 * `monitorSeasons` limits monitoring to the listed seasons — and now also limits
 * what is stored at all, since only a watched season has rows. An empty list is the
 * instant download: the row exists so the torrent has something to be tracked by,
 * and not one episode is claimed as wanted. Without the argument the whole show is
 * watched, which is the plain "add this to my watchlist" case.
 */
export const addToWatchlist = async (tmdbId: number, type: ContentType, monitorSeasons?: number[]) => {
    // the TMDB lookup doubles as validation of the id
    const metadata = await getMediaMetadata(toMediaType(type), tmdbId);

    if (! metadata) {
        return null;
    }

    // "watch this show" keeps following it into seasons that do not exist yet;
    // picking seasons by hand does not, and an existing row keeps what it had
    const monitorNewSeasons = type === ContentType.TV && ! monitorSeasons ? { monitorNewSeasons: true } : {};

    const item = await prisma.watchlist.upsert({
        where: { tmdbId_type: { tmdbId, type } },
        update: monitorNewSeasons,
        create: { tmdbId, type, ...monitorNewSeasons }
    });

    if (type === ContentType.MOVIE) {
        await ensureMovieUnit(item.id, toAirDate(metadata.media.date));

    } else if (! monitorSeasons) {
        await ensureSeasonUnits(item.id, tmdbId, undefined, true);

    } else {
        // whatever is already there keeps following TMDB, and the picked seasons
        // are created on top of it
        await syncTvSeasons(item.id, tmdbId);

        if (monitorSeasons.length > 0) {
            await ensureSeasonUnits(item.id, tmdbId, monitorSeasons, true);
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
    await prisma.watchlist.update({ where: { id }, data: { monitorNewSeasons: false } });
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

/** The only reason to keep a row for something that is not watched. */
const HAD = [ PrismaWatchStatus.DOWNLOADING, PrismaWatchStatus.DOWNLOADED ];

/**
 * Drops the units that are neither watched nor had. A search that came back empty
 * is bookkeeping, not a possession: once a unit is not watched any more, its
 * SEARCHING or FAILED state is about a search nobody asked for, and it must not
 * keep the row alive — otherwise the very scanning that a title needs while it
 * waits for a release is what pins it to the watchlist.
 */
const dropIdleUnits = async (watchlistId: number) => {
    return await prisma.watchlistUnit.deleteMany({
        where: { watchlistId, monitored: false, status: { notIn: HAD } }
    });
};

/**
 * A show nobody watches and nothing was downloaded from has no reason to sit on the
 * watchlist — unchecking the last episode has to take the row with it.
 */
export const pruneWatchlistItem = async (id: number): Promise<WatchlistItem | null> => {
    await dropIdleUnits(id);

    const keep = await prisma.watchlistUnit.count({ where: { watchlistId: id } });

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

    // naming no season means the show itself, which is the one thing that decides
    // whether a season nobody has heard of yet will be followed
    if (type === ContentType.TV && target.seasonNumber === undefined) {
        await prisma.watchlist.update({ where: { id: row.id }, data: { monitorNewSeasons: monitored } });
    }

    // ticking creates the rows, unticking lets `pruneWatchlistItem` take them away
    if (monitored && type === ContentType.TV) {
        if (target.episodeNumbers && target.seasonNumber !== undefined) {
            await ensureEpisodeUnits(row.id, tmdbId, target.seasonNumber, target.episodeNumbers, true);

        } else {
            // a whole season, or the whole show when no season was named
            const seasons = target.seasonNumber === undefined ? undefined : [ target.seasonNumber ];

            await ensureSeasonUnits(row.id, tmdbId, seasons, true);
        }

    } else {
        await prisma.watchlistUnit.updateMany({
            where: {
                watchlistId: row.id,
                seasonNumber: target.seasonNumber ?? { not: null },
                ...(target.episodeNumbers ? { episodeNumber: { in: target.episodeNumbers } } : {})
            },
            data: { monitored }
        });
    }

    return await pruneWatchlistItem(row.id);
};
