import {
    ContentType,
    LibraryStatus as PrismaLibraryStatus,
    Prisma,
    WatchStatus as PrismaWatchStatus
} from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { getMediaMetadata, getTvSeasons } from "@/lib/media";
import { WatchlistEntry, WatchlistItem, WatchlistRowItem, WatchlistSeasonItem, WatchlistStatus } from "@/types/watchlist";

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
        // a row with no units has nothing left to look for, which is all a watchlist
        // row is. one can exist for a moment between a restore and its units
        where: { units: { some: {} } },
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

// an unknown date does not hold anything back — the scanner searches those
const airsLater = (airDate: Date | null) => !! airDate && airDate.getTime() > Date.now();

/**
 * The earliest date something still wanted is waiting for, which is what makes
 * `UPCOMING` explainable instead of just "nothing is happening".
 */
const nextAirDate = (units: UnitRow[]): string | null => {
    const dates = units
        .map(unit => unit.airDate)
        .filter((date): date is Date => airsLater(date))
        .map(date => date.getTime());

    return dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : null;
};

/**
 * A watchlist row only holds what is still to be found, so its status can only say
 * how the looking is going. Anything obtained is a library row and shows up in the
 * merged entry below.
 */
export const deriveStatus = (item: WatchlistRow): WatchlistStatus => {
    const units = item.units;

    if (units.length === 0) {
        return PrismaWatchStatus.PENDING;
    }

    if (units.some(u => u.status === PrismaWatchStatus.SEARCHING)) {
        return PrismaWatchStatus.SEARCHING;
    }

    // nothing is being looked for, and nothing can be: every part still wanted airs
    // later, and the scanner deliberately leaves those alone
    if (units.every(unit => airsLater(unit.airDate))) {
        return "UPCOMING";
    }

    return PrismaWatchStatus.PENDING;
};

/**
 * What the library knows about a title. Two tables answer one question — "where is
 * this?" — and the badge on a poster has to say it in one word.
 */
type LibraryState = { items: number, downloading: number, held: number, available: number };

const EMPTY_STATE: LibraryState = { items: 0, downloading: 0, held: 0, available: 0 };

const key = (type: ContentType, tmdbId: number) => `${ toMediaType(type) }:${ tmdbId }`;

const libraryState = async (): Promise<Map<string, LibraryState>> => {
    const items = await prisma.libraryItem.findMany({
        where: { removedAt: null },
        include: { episodes: { select: { id: true } } }
    });

    const map = new Map<string, LibraryState>();

    for (const item of items) {
        const seen = map.get(key(item.type, item.tmdbId)) || { ...EMPTY_STATE };
        const available = item.status === PrismaLibraryStatus.AVAILABLE;

        map.set(key(item.type, item.tmdbId), {
            // a film is one item and no episodes, so counting rows is the only way
            // to ask "is there anything of this at all"
            items: seen.items + 1,
            downloading: seen.downloading + (available ? 0 : 1),
            held: seen.held + item.episodes.length,
            available: seen.available + (available ? item.episodes.length : 0)
        });
    }

    return map;
};

/**
 * The state of a title as a poster has to show it: being looked for, on its way, or
 * on disk. A show can be all three at once — two episodes downloaded, one
 * downloading, four still waiting for their air date — and then the most active
 * thing wins, because that is the one that is about to change.
 */
export const toWatchlistEntry = (item: WatchlistRow | null, state: LibraryState, id: string): WatchlistEntry => {
    const [ type, tmdbId ] = id.split(":");
    const units = item ? item.units : [];

    const status: WatchlistStatus = state.downloading > 0
        ? PrismaWatchStatus.DOWNLOADING
        : item
            ? deriveStatus(item)
            : PrismaWatchStatus.DOWNLOADED;

    return {
        id: item ? item.id : null,
        tmdbId: item ? item.tmdbId : Number(tmdbId),
        type: item ? toMediaType(item.type) : type as "movie" | "tv",
        status,
        nextAirDate: nextAirDate(units),
        episodeCount: units.filter(unit => unit.episodeNumber !== null).length + state.held,
        downloadedCount: state.available,
        monitored: units.some(unit => unit.monitored)
    };
};

/**
 * Every title the app has an opinion about, from both tables: what it is watching
 * and what it has. A poster asks this once and never asks the database again.
 */
export const getWatchlistSlim = async (): Promise<WatchlistEntry[]> => {
    const items = await getWatchlist();
    const state = await libraryState();

    const entries = items.map(item => toWatchlistEntry(item, state.get(key(item.type, item.tmdbId)) || EMPTY_STATE, key(item.type, item.tmdbId)));
    const watched = new Set(items.map(item => key(item.type, item.tmdbId)));

    // in the library and nowhere else: a finished download has no watchlist row left
    for (const [ id, value ] of state) {
        if (! watched.has(id)) {
            entries.push(toWatchlistEntry(null, value, id));
        }
    }

    return entries;
};

/**
 * Where every episode of a title is, as far as the library knows. A season with no
 * units left is still a season on the details page, so this is what draws it.
 */
const libraryEpisodes = async (tmdbId: number) => {
    const rows = await prisma.libraryEpisode.findMany({
        where: { item: { tmdbId, removedAt: null } },
        select: { seasonNumber: true, episodeNumber: true, item: { select: { status: true } } }
    });

    const map = new Map<string, PrismaWatchStatus>();

    for (const row of rows) {
        map.set(`${ row.seasonNumber }:${ row.episodeNumber }`, row.item.status === PrismaLibraryStatus.AVAILABLE
            ? PrismaWatchStatus.DOWNLOADED
            : PrismaWatchStatus.DOWNLOADING);
    }

    return map;
};

/**
 * Seasons are not stored, they are read back from the numbers on the units — and
 * now also from the library, because an episode that has been obtained no longer
 * has a unit at all.
 */
const toSeasons = (units: UnitRow[], held: Map<string, PrismaWatchStatus>, withEpisodes: boolean): WatchlistSeasonItem[] => {
    const seasons = new Map<number, Map<number, { monitored: boolean, status: PrismaWatchStatus, airDate: Date | null }>>();

    const put = (seasonNumber: number, episodeNumber: number, value: { monitored: boolean, status: PrismaWatchStatus, airDate: Date | null }) => {
        const season = seasons.get(seasonNumber) || new Map();

        season.set(episodeNumber, value);
        seasons.set(seasonNumber, season);
    };

    for (const unit of units) {
        if (unit.seasonNumber === null || unit.episodeNumber === null) {
            continue;
        }

        put(unit.seasonNumber, unit.episodeNumber, { monitored: unit.monitored, status: unit.status, airDate: unit.airDate });
    }

    for (const [ id, status ] of held) {
        const [ seasonNumber, episodeNumber ] = id.split(":").map(Number);

        // being had is not being watched: there is nothing left to look for
        put(seasonNumber, episodeNumber, { monitored: false, status, airDate: null });
    }

    return [ ...seasons.entries() ]
        .sort(([ a ], [ b ]) => a - b)
        .map(([ seasonNumber, episodes ]) => {
            const list = [ ...episodes.entries() ].sort(([ a ], [ b ]) => a - b);

            return {
                seasonNumber,
                monitored: list.some(([ , episode ]) => episode.monitored),
                episodeCount: list.length,
                downloadedCount: list.filter(([ , episode ]) => episode.status === PrismaWatchStatus.DOWNLOADED).length,
                ...(withEpisodes ? {
                    episodes: list.map(([ episodeNumber, episode ]) => ({
                        episodeNumber,
                        monitored: episode.monitored,
                        status: episode.status,
                        airDate: episode.airDate ? episode.airDate.toISOString() : null
                    }))
                } : {})
            };
        });
};

/**
 * Adds TMDB metadata to a row. On a TMDB failure `media` is null and only the
 * watch state is shown.
 */
export const withMedia = async (item: WatchlistRow, state: LibraryState, withEpisodes = false): Promise<WatchlistRowItem> => {
    const metadata = await getMediaMetadata(toMediaType(item.type), item.tmdbId);
    const units = item.units;
    const checked = units.map(unit => unit.lastCheckedAt).filter((v): v is Date => !! v);
    const held = await libraryEpisodes(item.tmdbId);

    return {
        ...toWatchlistEntry(item, state, key(item.type, item.tmdbId)),
        // a row exists, so unlike the merged entry this one always has an id
        id: item.id,
        media: metadata ? metadata.media : null,
        addedAt: item.addedAt.toISOString(),
        lastCheckedAt: checked.length > 0 ? new Date(Math.max(...checked.map(v => v.getTime()))).toISOString() : null,
        searchAttempts: units.reduce((max, unit) => Math.max(max, unit.searchAttempts), 0),
        seasons: toSeasons(units, held, withEpisodes)
    };
};

/**
 * The watchlist as a page shows it: what is still to be found. No torrent is read
 * here any more — a download lives in the library from the moment it starts.
 */
export const getWatchlistWithMedia = async (): Promise<WatchlistRowItem[]> => {
    const items = await getWatchlist();
    const state = await libraryState();

    return await Promise.all(items.map(item => withMedia(item, state.get(key(item.type, item.tmdbId)) || EMPTY_STATE)));
};

export const getWatchlistItemWithMedia = async (id: number): Promise<WatchlistRowItem | null> => {
    const item = await getWatchlistItem(id);

    if (! item) {
        return null;
    }

    const state = await libraryState();

    return await withMedia(item, state.get(key(item.type, item.tmdbId)) || EMPTY_STATE, true);
};

/**
 * Everything known about one title, from both tables — what the details page draws
 * its ticks and per episode states from. A show whose every episode is downloaded
 * has no watchlist row at all, and it still has to show as downloaded.
 */
export const getTitleState = async (type: ContentType, tmdbId: number): Promise<WatchlistItem | null> => {
    const row = await getWatchlistItemByTmdbId(tmdbId, type);
    const state = (await libraryState()).get(key(type, tmdbId)) || EMPTY_STATE;

    if (row) {
        return await withMedia(row, state, true);
    }

    if (state.items === 0) {
        return null;
    }

    const held = await libraryEpisodes(tmdbId);

    const metadata = await getMediaMetadata(toMediaType(type), tmdbId);

    return {
        ...toWatchlistEntry(null, state, key(type, tmdbId)),
        media: metadata ? metadata.media : null,
        addedAt: new Date().toISOString(),
        lastCheckedAt: null,
        searchAttempts: 0,
        seasons: toSeasons([], held, true)
    };
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

    // An obtained episode has no unit, so the watermark below would slide back down
    // and offer it again. The library remembers everything ever downloaded, deleted
    // ones included, and that is exactly what "already offered" means here.
    const obtained = await prisma.libraryEpisode.findMany({
        where: { item: { tmdbId } },
        select: { seasonNumber: true, episodeNumber: true, item: { select: { watched: true } } }
    });

    // and once a season's last unit is carried off by a download, the library is
    // also the only thing that still knows the season was being watched
    const watchedSeasons = new Set(obtained.filter(episode => episode.item.watched).map(episode => episode.seasonNumber));

    const known = [ ...units.map(unit => unit.seasonNumber as number), ...obtained.map(episode => episode.seasonNumber) ];
    const latest = known.length > 0 ? Math.max(...known) : null;

    for (const season of seasons) {
        const own = units.filter(unit => unit.seasonNumber === season.season_number);
        const had = obtained.filter(episode => episode.seasonNumber === season.season_number);

        const watched = own.some(unit => unit.monitored)
            || watchedSeasons.has(season.season_number)
            || (!! item?.monitorNewSeasons && (latest === null || season.season_number > latest));

        // A watched season picks up what is announced above it, never what sits
        // below: with no rows for the unwanted, "not stored" and "declined" look the
        // same, and the episode number is what tells them apart. Watching a show from
        // its fourth episode on must not silently become watching all four.
        const seen = [
            ...own.map(unit => unit.episodeNumber as number),
            ...had.map(episode => episode.episodeNumber)
        ];

        const highest = seen.length > 0 ? Math.max(...seen) : null;

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
 * Stop watching: the watchlist is only what is still to be found, so nothing is
 * left to keep the row for. What was already downloaded is a library row and is
 * untouched by this — the torrent client is not asked anything either.
 */
export const stopWatching = async (id: number) => {
    await prisma.watchlist.update({ where: { id }, data: { monitorNewSeasons: false } });
    await prisma.watchlistUnit.updateMany({ where: { watchlistId: id }, data: { monitored: false } });

    return await pruneWatchlistItem(id);
};

export const getSeasonUnits = async (watchlistId: number, seasonNumber: number) => {
    return await prisma.watchlistUnit.findMany({
        where: { watchlistId, seasonNumber },
        orderBy: { episodeNumber: "asc" }
    });
};

/**
 * A unit that is not watched has nothing left to say. A search that came back empty
 * is bookkeeping, not a possession, and it must not keep the row alive — otherwise
 * the very scanning that a title needs while it waits for a release is what pins it
 * to the watchlist.
 */
const dropIdleUnits = async (watchlistId: number) => {
    return await prisma.watchlistUnit.deleteMany({ where: { watchlistId, monitored: false } });
};

/**
 * A show nobody watches any more has no reason to sit on the watchlist — unchecking
 * the last episode has to take the row with it.
 */
export const pruneWatchlistItem = async (id: number): Promise<WatchlistRowItem | null> => {
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
): Promise<WatchlistRowItem | null> => {
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
