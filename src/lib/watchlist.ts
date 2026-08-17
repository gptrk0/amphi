import {
    ContentType,
    LibraryStatus as PrismaLibraryStatus,
    Prisma,
    WatchStatus as PrismaWatchStatus
} from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { audienceForUser, LibraryAudience, libraryFilter } from "@/lib/audience";
import { languageProfileOf, searchLanguages } from "@/lib/language";
import { getMediaMetadata, getTvSeasons } from "@/lib/media";
import { WatchlistEntry, WatchlistItem, WatchlistRowItem, WatchlistSeasonItem, WatchlistStatus } from "@/types/watchlist";

/**
 * One watchlist per person, and the library shared between them.
 *
 * **What that costs, everywhere in this file.** Nothing here can ask "is this being
 * watched" and get one answer any more — three people wanting the same show is three
 * rows and three sets of units. So every read takes a `userId` and every write that
 * acts on a *title* rather than on a person's intent has to reach all of them. The
 * ones that do are in `library.ts`, where a download carries units off every list at
 * once; the ones here are per person by design.
 */
export const watchlistInclude = {
    units: {
        orderBy: [
            { seasonNumber: "asc" },
            { episodeNumber: "asc" }
        ]
    },
    // the owner travels with the row, because an administrator looking at everybody's
    // lists has to see whose each one is
    user: { select: { id: true, name: true } }
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

/** `userId` is one person's list; leaving it out is every list there is. */
export const getWatchlist = async (userId?: number) => {
    return await prisma.watchlist.findMany({
        where: {
            ...(userId === undefined ? {} : { userId }),
            // a row with no units has nothing left to look for, which is all a watchlist
            // row is. one can exist for a moment between a restore and its units
            units: { some: {} }
        },
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

export const getWatchlistItemByTmdbId = async (userId: number, tmdbId: number, type: ContentType) => {
    return await prisma.watchlist.findUnique({
        where: { userId_tmdbId_type: { userId, tmdbId, type } },
        include: watchlistInclude
    });
};

/** The same title on everybody's list, which is what a download has to clear. */
export const rowsForTitle = async (tmdbId: number, type: ContentType) => {
    return await prisma.watchlist.findMany({ where: { tmdbId, type } });
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
    // only what is watched: an unticked unit is a remembered "no" (see
    // `pruneWatchlistItem`), and it must not make the row look like it is waiting for
    // something
    const units = item.units.filter(unit => unit.monitored);

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

/**
 * `audience` is what makes this personal: a download counts for the people whose
 * edition it is, so an English copy of a film does not put an "Available" badge on a
 * poster for somebody who is still waiting for the Hungarian one. `null` is the whole
 * shelf, which is what a list of everybody's rows is drawn from.
 */
const libraryState = async (audience: LibraryAudience | null): Promise<Map<string, LibraryState>> => {
    const items = await prisma.library.findMany({ where: libraryFilter(audience) });

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
    // the counts and the next air date are about what is being waited for, so an
    // unticked unit is not one of them
    const units = (item ? item.units : []).filter(unit => unit.monitored);

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
export const getWatchlistSlim = async (userId: number): Promise<WatchlistEntry[]> => {
    const items = await getWatchlist(userId);
    const state = await libraryState(await audienceForUser(userId));

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
const libraryEpisodes = async (tmdbId: number, audience: LibraryAudience | null) => {
    const items = await prisma.library.findMany({
        where: { tmdbId, ...libraryFilter(audience) },
        select: { status: true, episodes: true }
    });

    const map = new Map<string, PrismaWatchStatus>();

    for (const item of items) {
        for (const key of item.episodes) {
            map.set(key, item.status === PrismaLibraryStatus.AVAILABLE
                ? PrismaWatchStatus.DOWNLOADED
                : PrismaWatchStatus.DOWNLOADING);
        }
    }

    return map;
};

/** An episode key as the library writes it, read back as numbers. */
const toEpisodeRef = (key: string) => {
    const [ seasonNumber, episodeNumber ] = key.split(":").map(Number);

    return { seasonNumber, episodeNumber };
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
        const { seasonNumber, episodeNumber } = toEpisodeRef(id);
        const unit = seasons.get(seasonNumber)?.get(episodeNumber);

        // Being had is the stronger fact about the *status* — but it must not silently
        // untick anything. This used to write `monitored: false` over whatever the unit
        // said, and a tick the page cannot draw is a tick nobody can take back: the show
        // stayed on the watchlist with every episode showing as unticked, and there was
        // nothing on screen to explain why. (Regular Show, 2026-08-10.)
        put(seasonNumber, episodeNumber, {
            monitored: unit?.monitored ?? false,
            status,
            airDate: unit?.airDate ?? null
        });
    }

    return [ ...seasons.entries() ]
        .sort(([ a ], [ b ]) => a - b)
        .map(([ seasonNumber, episodes ]) => {
            const list = [ ...episodes.entries() ].sort(([ a ], [ b ]) => a - b);

            return {
                seasonNumber,
                monitored: list.some(([ , episode ]) => episode.monitored),
                // what this season means to this person: what is watched, plus what is
                // already had. An unticked episode is neither, and counting it would make
                // "3 episodes" out of a season nobody is waiting for
                episodeCount: list.filter(([ , episode ]) => episode.monitored
                    || episode.status === PrismaWatchStatus.DOWNLOADED
                    || episode.status === PrismaWatchStatus.DOWNLOADING).length,
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
    // the row's owner, not whoever is looking: the ticks on a row say where *their*
    // copy is, and a row is always somebody's. The row's own language too, when it named
    // one — an English copy is what answers a row that asked for English
    const held = await libraryEpisodes(item.tmdbId, await audienceForUser(item.userId, item.language));

    return {
        ...toWatchlistEntry(item, state, key(item.type, item.tmdbId)),
        // a row exists, so unlike the merged entry this one always has an id
        id: item.id,
        owner: { id: item.user.id, name: item.user.name },
        media: metadata ? metadata.media : null,
        addedAt: item.addedAt.toISOString(),
        lastCheckedAt: checked.length > 0 ? new Date(Math.max(...checked.map(v => v.getTime()))).toISOString() : null,
        searchAttempts: units.reduce((max, unit) => Math.max(max, unit.searchAttempts), 0),
        language: item.language,
        searchLanguages: searchLanguages(await languageProfileOf(item.userId), item.language),
        seasons: toSeasons(units, held, withEpisodes)
    };
};

/**
 * The watchlist as a page shows it: what is still to be found. No torrent is read
 * here any more — a download lives in the library from the moment it starts.
 */
export const getWatchlistWithMedia = async (userId?: number): Promise<WatchlistRowItem[]> => {
    const items = await getWatchlist(userId);
    const state = await libraryState(userId === undefined ? null : await audienceForUser(userId));

    return await Promise.all(items.map(item => withMedia(item, state.get(key(item.type, item.tmdbId)) || EMPTY_STATE)));
};

export const getWatchlistItemWithMedia = async (id: number): Promise<WatchlistRowItem | null> => {
    const item = await getWatchlistItem(id);

    if (! item) {
        return null;
    }

    const state = await libraryState(await audienceForUser(item.userId, item.language));

    return await withMedia(item, state.get(key(item.type, item.tmdbId)) || EMPTY_STATE, true);
};

/**
 * Everything known about one title, from both tables — what the details page draws
 * its ticks and per episode states from. A show whose every episode is downloaded
 * has no watchlist row at all, and it still has to show as downloaded.
 */
export const getTitleState = async (userId: number, type: ContentType, tmdbId: number): Promise<WatchlistItem | null> => {
    const row = await getWatchlistItemByTmdbId(userId, tmdbId, type);
    const audience = await audienceForUser(userId, row?.language);
    const state = (await libraryState(audience)).get(key(type, tmdbId)) || EMPTY_STATE;

    if (row) {
        return await withMedia(row, state, true);
    }

    if (state.items === 0) {
        return null;
    }

    const held = await libraryEpisodes(tmdbId, audience);

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
    monitored = false,
    // episode keys to leave alone entirely. Only the ticking path passes this — a
    // restore has to be able to create a unit for something the library still holds,
    // since the row it is restoring from is deleted a moment later
    skip?: Set<string>
) => {
    const season = (await getTvSeasons(tmdbId)).find(v => v.season_number === seasonNumber);
    const units = [];

    for (const episodeNumber of episodeNumbers) {
        if (skip?.has(`${ seasonNumber }:${ episodeNumber }`)) {
            continue;
        }

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
    monitored = false,
    skip?: Set<string>
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
            monitored,
            skip
        ));
    }

    return units;
};

/**
 * Every episode of a title this install has ever downloaded, deleted copies included —
 * "already offered", as `syncTvSeasons` means it. With a `userId`, which of them that
 * person actually watched, which is what keeps a season followed after its last unit
 * has been carried off.
 */
const obtainedEpisodes = async (tmdbId: number, userId?: number) => {
    const downloads = await prisma.library.findMany({
        where: { tmdbId },
        select: { watchedBy: true, episodes: true }
    });

    return downloads.flatMap(download => download.episodes.map(key => ({
        ...toEpisodeRef(key),
        watched: userId !== undefined && download.watchedBy.includes(userId)
    })));
};

/**
 * The highest episode of a season anything already knows about: a unit of this row,
 * ticked or not, or a download that carried one off.
 *
 * This is the line the whole idea of a stored "no" hangs on. Nothing below it can ever
 * be taken up again, so nothing below it is worth writing down.
 */
const seasonWatermark = async (watchlistId: number, tmdbId: number, seasonNumber: number) => {
    const units = await prisma.watchlistUnit.findMany({ where: { watchlistId, seasonNumber } });
    const obtained = await obtainedEpisodes(tmdbId);

    const numbers = [
        ...units.map(unit => unit.episodeNumber).filter((v): v is number => v !== null),
        ...obtained.filter(episode => episode.seasonNumber === seasonNumber).map(episode => episode.episodeNumber)
    ];

    return numbers.length > 0 ? Math.max(...numbers) : null;
};

/**
 * Throws away the unticked units nothing can ever read again — and after this, unticking
 * a season really does empty it out of the database rather than turning it grey.
 *
 * An unticked unit is a remembered "no", and exactly one thing ever reads one:
 * `syncTvSeasons`, which uses it to tell "declined" apart from "announced while nobody
 * was looking". So a decline is only worth its row while that question can still be
 * asked about it, and there are two ways it stops being askable.
 *
 * **The season is not followed at all.** Nothing in it is ticked, no download of it was
 * watched, and new seasons are not being picked up — then `syncTvSeasons` will not take
 * up anything of it whatever it finds stored, and every "no" in it is answering nobody.
 * Unticking a whole season used to leave one row per episode behind for good.
 *
 * **It is below the season's watermark.** A followed season is only ever extended
 * *above* the highest episode it already knows about, so a "no" under that line is
 * unreachable too. The top one is always kept: when it is the watermark itself, dropping
 * it would move the line down and offer the episode all over again — which is the one
 * thing declines exist to prevent (Regular Show, 2026-08-10).
 *
 * A season the newest of which is unticked while `monitorNewSeasons` is on keeps its top
 * row for the same reason: that row is the line, and without it the season reads as one
 * that has just been announced.
 */
const pruneDeclinedUnits = async (watchlistId: number) => {
    const item = await prisma.watchlist.findUnique({ where: { id: watchlistId } });

    if (! item) {
        return 0;
    }

    const units = await prisma.watchlistUnit.findMany({ where: { watchlistId, seasonNumber: { not: null } } });
    const obtained = await obtainedEpisodes(item.tmdbId, item.userId);

    const watchedSeasons = new Set(obtained.filter(episode => episode.watched).map(episode => episode.seasonNumber));

    const known = [ ...units.map(unit => unit.seasonNumber as number), ...obtained.map(episode => episode.seasonNumber) ];
    const latest = known.length > 0 ? Math.max(...known) : null;

    const spent: number[] = [];

    for (const seasonNumber of new Set(units.map(unit => unit.seasonNumber as number))) {
        const own = units.filter(unit => unit.seasonNumber === seasonNumber);
        const declined = own.filter(unit => ! unit.monitored && unit.episodeNumber !== null);

        const followed = own.some(unit => unit.monitored)
            || watchedSeasons.has(seasonNumber)
            // `>=` rather than `>`: this season *is* the line while its rows are here, and
            // taking the last of them away is what would drop it below itself
            || (item.monitorNewSeasons && latest !== null && seasonNumber >= latest);

        if (! followed) {
            spent.push(...declined.map(unit => unit.id));

            continue;
        }

        const numbers = [
            ...own.map(unit => unit.episodeNumber).filter((v): v is number => v !== null),
            ...obtained.filter(episode => episode.seasonNumber === seasonNumber).map(episode => episode.episodeNumber)
        ];

        const watermark = Math.max(...numbers);

        spent.push(...declined.filter(unit => (unit.episodeNumber as number) < watermark).map(unit => unit.id));
    }

    if (spent.length === 0) {
        return 0;
    }

    await prisma.watchlistUnit.deleteMany({ where: { id: { in: spent } } });

    return spent.length;
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

    if (! item) {
        return 0;
    }

    const units = await prisma.watchlistUnit.findMany({ where: { watchlistId, seasonNumber: { not: null } } });

    // An obtained episode has no unit, so the watermark below would slide back down
    // and offer it again. The library remembers everything ever downloaded, deleted
    // ones included, and that is exactly what "already offered" means here.
    //
    // That half is deliberately everybody's: the file is on the disk whoever fetched
    // it, so nobody has to be offered it again.
    const obtained = await obtainedEpisodes(tmdbId, item.userId);

    // The other half is not. Once a season's last unit is carried off by a download,
    // the library is the only thing that still knows the season was being watched —
    // and by whom, which is what decides whose list its next episode lands on.
    const watchedSeasons = new Set(obtained.filter(episode => episode.watched).map(episode => episode.seasonNumber));

    const known = [ ...units.map(unit => unit.seasonNumber as number), ...obtained.map(episode => episode.seasonNumber) ];
    const latest = known.length > 0 ? Math.max(...known) : null;

    for (const season of seasons) {
        const own = units.filter(unit => unit.seasonNumber === season.season_number);
        const had = obtained.filter(episode => episode.seasonNumber === season.season_number);

        const watched = own.some(unit => unit.monitored)
            || watchedSeasons.has(season.season_number)
            || (item.monitorNewSeasons && (latest === null || season.season_number > latest));

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

    // after the creations, not before: a season this round just took up is followed from
    // now on, and its stored "no"s are read against a watermark that has moved
    await pruneDeclinedUnits(watchlistId);

    return seasons.length;
};

/**
 * `monitorSeasons` limits monitoring to the listed seasons — and now also limits
 * what is stored at all, since only a watched season has rows. An empty list is the
 * instant download: the row exists so the torrent has something to be tracked by,
 * and not one episode is claimed as wanted. Without the argument the whole show is
 * watched, which is the plain "add this to my watchlist" case.
 */
export const addToWatchlist = async (userId: number, tmdbId: number, type: ContentType, monitorSeasons?: number[]) => {
    // the TMDB lookup doubles as validation of the id
    const metadata = await getMediaMetadata(toMediaType(type), tmdbId);

    if (! metadata) {
        return null;
    }

    // "watch this show" keeps following it into seasons that do not exist yet;
    // picking seasons by hand does not, and an existing row keeps what it had
    const monitorNewSeasons = type === ContentType.TV && ! monitorSeasons ? { monitorNewSeasons: true } : {};

    // whether this row was already here, which decides whether there is any history to
    // carry forward at all — see the season branch below
    const existing = await prisma.watchlist.findUnique({ where: { userId_tmdbId_type: { userId, tmdbId, type } } });

    const item = await prisma.watchlist.upsert({
        where: { userId_tmdbId_type: { userId, tmdbId, type } },
        update: monitorNewSeasons,
        create: { userId, tmdbId, type, ...monitorNewSeasons }
    });

    if (type === ContentType.MOVIE) {
        await ensureMovieUnit(item.id, toAirDate(metadata.media.date));

    } else if (! monitorSeasons) {
        await ensureSeasonUnits(item.id, tmdbId, undefined, true);

    } else {
        // Whatever is already there keeps following TMDB, and the picked seasons are
        // created on top of it.
        //
        // A row that did not exist a moment ago has nothing to carry forward, and letting
        // it follow TMDB anyway is how a show somebody had cleared off their list came
        // back on it. `syncTvSeasons` reads the library for who watched which season, and
        // that memory outlives the row: taking every episode of Silo off the list and then
        // ticking one episode of season 2 recreated season 3 from the last downloaded
        // episode up, monitored, ready to grab. Picking seasons by hand means those
        // seasons and no others.
        if (existing) {
            await syncTvSeasons(item.id, tmdbId);
        }

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
 * Which language this one title is wanted in. Empty hands it back to the account, which
 * is the normal state and the reason this is stored as "" rather than as a copy of the
 * account's answer: change the account and every row that never asked for anything of
 * its own follows it.
 *
 * The search starts over with it. A row that has spent two days failing to find a
 * Hungarian release is down to one look every twelve hours by then — and the English
 * search it is now asking for has never been made once, so making it wait would be
 * answering the old question. That is `searchingSince` as much as the counter: the age
 * the ladder is read off belongs to a search that is over. The status is left alone:
 * `SEARCHING` is still true, it just says nothing about the new language.
 */
export const setRequestedLanguage = async (id: number, language: string) => {
    await prisma.watchlist.update({ where: { id }, data: { language } });

    await prisma.watchlistUnit.updateMany({
        where: { watchlistId: id },
        data: { searchAttempts: 0, lastCheckedAt: null, searchingSince: null }
    });

    return await getWatchlistItemWithMedia(id);
};

/**
 * Whose want this row is.
 *
 * One watchlist per person means the owner is not a label on the row — it *is* the row, so
 * this hands the whole thing over: its units, its history and its language go with it, and
 * the person it left has nothing of it any more. Which is what makes it an administrator's
 * only, and why the caller has to have checked first that the row is not already on the
 * other person's list: `userId + tmdbId + type` is unique, and two rows for the same title
 * cannot be one.
 *
 * **The search may start over.** What a row is looked for in is the owner's account rule
 * unless the row named a language of its own — so a handover can change what is being
 * searched for without touching the row's own answer. When it does, the ladder is reset for
 * the same reason `setRequestedLanguage` resets it: the two days of failure behind the
 * current backoff were spent on a question nobody is asking any more. When it does not,
 * the backoff is left where it is; nothing about the search changed.
 */
export const setOwner = async (id: number, userId: number) => {
    const item = await prisma.watchlist.findUnique({ where: { id } });

    if (! item || item.userId === userId) {
        return await getWatchlistItemWithMedia(id);
    }

    const before = searchLanguages(await languageProfileOf(item.userId), item.language);
    const after = searchLanguages(await languageProfileOf(userId), item.language);

    await prisma.watchlist.update({ where: { id }, data: { userId } });

    if (before.join(",") !== after.join(",")) {
        await prisma.watchlistUnit.updateMany({
            where: { watchlistId: id },
            data: { searchAttempts: 0, lastCheckedAt: null, searchingSince: null }
        });
    }

    return await getWatchlistItemWithMedia(id);
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

/**
 * A show nobody watches any more has no reason to sit on the watchlist — unchecking
 * the last episode has to take the row with it.
 *
 * **What decides is what is monitored, not what has a row.** An unticked unit is kept,
 * with `monitored = false`, because that row is the only place a *decline* can live: with
 * no row at all, "never wanted" and "explicitly unticked" look identical, and
 * `syncTvSeasons` reads a missing episode of a watched season as a new one and turns it
 * back on. Deleting them was how unticking the tail of a season came back fifteen minutes
 * later, monitored, ready to download — measured on Regular Show, 2026-08-10.
 *
 * They cost nothing while the row lives and they go with it when it dies: the row is
 * deleted the moment nothing on it is monitored, and the units cascade.
 *
 * **Only the ones still worth keeping**, though, and that is decided here rather than
 * fifteen minutes later by a metadata round — see `pruneDeclinedUnits`. Unticking is
 * something a person does and then looks at, so it has to leave the table the way they
 * would describe it: a season nobody is watching any more is gone from the database, not
 * greyed out in it.
 */
export const pruneWatchlistItem = async (id: number): Promise<WatchlistRowItem | null> => {
    await pruneDeclinedUnits(id);

    const watched = await prisma.watchlistUnit.count({ where: { watchlistId: id, monitored: true } });

    if (watched > 0) {
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
    userId: number,
    tmdbId: number,
    type: ContentType,
    monitored: boolean,
    target: { seasonNumber?: number, episodeNumbers?: number[] } = {}
): Promise<WatchlistRowItem | null> => {
    let row = await prisma.watchlist.findUnique({ where: { userId_tmdbId_type: { userId, tmdbId, type } } });

    if (! row) {
        if (! monitored) {
            return null;
        }

        // added with nothing monitored; only the requested part is turned on below
        const created = await addToWatchlist(userId, tmdbId, type, []);

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
        // What is already on the disk is left out of it. A unit for an episode the
        // library holds has nothing to search for: the scanner only hands it straight
        // back on its next round, and until it does, the show sits on the watchlist for
        // an episode that is already there. Ticking a whole season used to create one for
        // every episode in it, downloaded ones included.
        const held = new Set((await libraryEpisodes(tmdbId, await audienceForUser(userId, row.language))).keys());

        if (target.episodeNumbers && target.seasonNumber !== undefined) {
            await ensureEpisodeUnits(row.id, tmdbId, target.seasonNumber, target.episodeNumbers, true, held);

            // The rest of the season, written down as declined. Without it "not stored"
            // means both "never announced" and "not picked", and `syncTvSeasons` reads
            // everything above the highest picked episode as newly announced and turns it
            // on — ticking E11 of a finished season quietly became watching E11 to E22.
            // Monitoring is never turned *off* here, so this cannot undo an existing tick.
            //
            // Only above the watermark, because that is the only half of the season that
            // could be read as newly announced. The half below it would be a "no" nothing
            // ever asks about again — ticking the last four of ten used to leave five such
            // rows behind, and they were what made a watchlist of four episodes look like
            // a table of nine.
            const announced = (await getTvSeasons(tmdbId))
                .find(season => season.season_number === target.seasonNumber)?.episodes || [];

            const watermark = await seasonWatermark(row.id, tmdbId, target.seasonNumber);

            const rest = announced
                .map(episode => episode.episode_number)
                .filter(number => ! target.episodeNumbers!.includes(number))
                .filter(number => watermark === null || number > watermark);

            await ensureEpisodeUnits(row.id, tmdbId, target.seasonNumber, rest, false, held);

        } else {
            // a whole season, or the whole show when no season was named
            const seasons = target.seasonNumber === undefined ? undefined : [ target.seasonNumber ];

            await ensureSeasonUnits(row.id, tmdbId, seasons, true, held);
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
