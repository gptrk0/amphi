import { ContentType, WatchStatus } from "../../prisma/generated/client";
import { refreshBlocklist } from "@/lib/blocklist";
import { findEpisodeReleases, findMovieReleases, findSeasonReleases, IndexerResult } from "@/lib/indexer";
import { getImdbId, getMediaMetadata, getTvSeasons } from "@/lib/media";
import {
    getQualityProfile,
    parseNumbering,
    ReleaseSelection,
    selectEpisodeRelease,
    selectRelease,
    selectSeasonRelease
} from "@/lib/release";
import { addRelease, episodeTag, movieTag, seasonTag } from "@/lib/torrent";
import {
    addToWatchlist,
    ensureMovieUnit,
    getSeasonUnits,
    getUnitsInSeasons,
    markUnitsDownloading
} from "@/lib/watchlist";

/**
 * The runners up are kept next to the winner so a download can be offered as a
 * choice. `release` stays the one the profile picked, which is what the scanner
 * takes without asking, and `filtered` is how many releases the profile threw
 * away — a count worth showing when nothing is left.
 */
export type ReleaseOptions = {
    candidates: IndexerResult[];
    filtered: number;
};

export type EpisodePlan = ReleaseOptions & {
    episodeNumber: number;
    aired: boolean;
    release: IndexerResult | null;
};

export type SeasonPlan = {
    seasonNumber: number;
    episodeCount: number;
    // every episode of the season is out, so a pack cannot be missing anything
    allAired: boolean;
    pack: IndexerResult | null;
    packOptions: ReleaseOptions;
    episodes: EpisodePlan[];
    missing: number[];
};

export type MoviePlan = ReleaseOptions & {
    release: IndexerResult | null;
    resultCount: number;
};

// how many releases a download dialog offers to choose from
const OPTION_COUNT = Number(process.env.DOWNLOAD_OPTION_COUNT || 5);

// Films and shows want different folders — every media server expects them apart.
// Empty leaves the destination to the qBittorrent category, as before.
const MOVIE_PATH = process.env.TORRENT_MOVIE_PATH || "";
const TV_PATH = process.env.TORRENT_SERIES_PATH || "";

const toOptions = (selection: ReleaseSelection): ReleaseOptions => {
    return {
        candidates: selection.candidates.slice(0, OPTION_COUNT).map(scored => scored.release),
        filtered: selection.rejected.length
    };
};

export type StartedDownload = {
    label: string;
    title: string;
    hash: string | null;
    episodeNumbers: number[];
};

export type PlannedGrab = {
    release: IndexerResult;
    episodeNumbers: number[];
    isPack: boolean;
};

export const planMovieGrab = async (tmdbId: number): Promise<MoviePlan | null> => {
    // scoring reads the blocklist synchronously, so it has to be in memory by then
    await refreshBlocklist();

    const metadata = await getMediaMetadata("movie", tmdbId);

    if (! metadata) {
        return null;
    }

    const releases = await findMovieReleases({
        imdbId: await getImdbId("movie", tmdbId),
        title: metadata.original_name,
        year: metadata.year
    });

    const selection = selectRelease(releases, getQualityProfile(), {
        titles: [ metadata.original_name, metadata.media.name ],
        kind: "movie",
        year: metadata.year,
        originalLanguage: metadata.original_language
    });

    return {
        release: selection.picked?.release || null,
        resultCount: releases.length,
        ...toOptions(selection)
    };
};

const EPISODE_SEARCH_CONCURRENCY = Number(process.env.EPISODE_SEARCH_CONCURRENCY || 3);

const mapLimited = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
    const results: R[] = new Array(items.length);
    let next = 0;

    const workers = Array.from({ length: Math.max(Math.min(limit, items.length), 1) }, async () => {
        while (next < items.length) {
            const index = next++;

            results[index] = await fn(items[index]);
        }
    });

    await Promise.all(workers);

    return results;
};

/**
 * Episodes are searched one by one, because a season search returns barely one
 * release per episode while a per episode search returns dozens. The season
 * search is still made once, for the pack and as a fallback pool.
 * `episodeNumbers` narrows the per episode searches down to the ones that are
 * actually about to be grabbed.
 */
export const planSeasonGrab = async (
    tmdbId: number,
    seasonNumber: number,
    options: { episodeNumbers?: number[] } = {}
): Promise<SeasonPlan | null> => {
    await refreshBlocklist();

    const metadata = await getMediaMetadata("tv", tmdbId);
    const seasons = await getTvSeasons(tmdbId);
    const season = seasons.find(v => v.season_number === seasonNumber);

    if (! metadata || ! season) {
        return null;
    }

    const imdbId = await getImdbId("tv", tmdbId);

    const releases = await findSeasonReleases({
        imdbId,
        title: metadata.original_name,
        season: seasonNumber
    });

    const profile = getQualityProfile();
    const titles = [ metadata.original_name, metadata.media.name ];
    const now = Date.now();

    const episodes: EpisodePlan[] = await mapLimited(season.episodes, EPISODE_SEARCH_CONCURRENCY, async (episode) => {
        const episodeNumber = episode.episode_number;
        const aired = !! episode.air_date && new Date(episode.air_date).getTime() <= now;

        // An episode that has not aired is never searched for, by any caller. A
        // release that exists before the episode does cannot be the episode — this
        // is the one check a faked release name cannot get past, and skipping it is
        // how a 1.2 GB `.scr` got in as Silo S03E07 on 2026-08-08.
        if (! aired) {
            return { episodeNumber, aired, release: null, candidates: [], filtered: 0 };
        }

        const own = options.episodeNumbers && ! options.episodeNumbers.includes(episodeNumber)
            ? []
            : await findEpisodeReleases({ imdbId, title: metadata.original_name, season: seasonNumber, episode: episodeNumber });

        const pool = own.length > 0 ? own : releases;
        const selection = selectEpisodeRelease(pool, seasonNumber, episodeNumber, profile, titles, metadata.original_language);

        return {
            episodeNumber,
            aired,
            release: selection.picked ? selection.picked.release : null,
            ...toOptions(selection)
        };
    });

    // always looked up, not only when an episode is missing: a season that is fully
    // out is worth taking as one torrent even if every episode is there on its own
    const packSelection = selectSeasonRelease(releases, seasonNumber, season.episodes.length, profile, titles, metadata.original_language);
    const pack = packSelection.picked?.release || null;

    // with a pack in hand everything already aired is obtainable, whether or not the
    // pack ends up being the one that is grabbed
    const missing = pack
        ? episodes.filter(episode => ! episode.aired).map(episode => episode.episodeNumber)
        : episodes.filter(episode => ! episode.release).map(episode => episode.episodeNumber);

    const allAired = episodes.length > 0 && episodes.every(episode => episode.aired);

    return {
        seasonNumber,
        episodeCount: season.episodes.length,
        allAired,
        pack,
        packOptions: toOptions(packSelection),
        episodes,
        missing
    };
};

// A download only needs a row to track the torrent by hash, so nothing is
// monitored yet — monitoring starts when the user asks for the missing parts.
const ensureWatchlistItem = (tmdbId: number, type: ContentType) => addToWatchlist(tmdbId, type, []);

export const executeMovieGrab = async (tmdbId: number, release: IndexerResult): Promise<StartedDownload | null> => {
    const item = await ensureWatchlistItem(tmdbId, ContentType.MOVIE);

    if (! item) {
        return null;
    }

    const unit = await ensureMovieUnit(item.id);
    const hash = await addRelease(release, movieTag(item.id), MOVIE_PATH);

    await markUnitsDownloading([ unit.id ], hash);

    return { label: "movie", title: release.title, hash, episodeNumbers: [] };
};

/**
 * Groups the episodes by the release that was picked for them: one multi episode
 * release (`S03E01-E06`) must be added once, not once per episode.
 */
export const planGrabs = (
    plan: SeasonPlan,
    eligible: number[],
    usePack: boolean,
    // what a wider release may claim beyond what was asked for: everything the
    // season still needs. defaults to the request itself
    claimable: number[] = eligible
): PlannedGrab[] => {
    if (usePack && plan.pack) {
        const covered = plan.episodes
            .filter(episode => episode.aired && eligible.includes(episode.episodeNumber))
            .map(episode => episode.episodeNumber);

        return covered.length > 0 ? [ { release: plan.pack, episodeNumbers: covered, isPack: true } ] : [];
    }

    const grabs = new Map<string, PlannedGrab>();

    for (const episode of plan.episodes) {
        if (! episode.release || ! eligible.includes(episode.episodeNumber)) {
            continue;
        }

        const key = episode.release.guid || episode.release.link;
        const existing = grabs.get(key);

        if (existing) {
            existing.episodeNumbers.push(episode.episodeNumber);
        } else {
            grabs.set(key, { release: episode.release, episodeNumbers: [ episode.episodeNumber ], isPack: false });
        }
    }

    // an `S01E01-E06` release downloads all six whether it was picked for one of
    // them or for all: it claims every episode it carries, and the widest release
    // wins the overlap — otherwise the same six files arrive twice
    const claiming = [ ...grabs.values() ].map(grab => ({
        ...grab,
        episodeNumbers: [ ...new Set([
            ...grab.episodeNumbers,
            ...parseNumbering(grab.release.title).episodes.filter(episodeNumber => claimable.includes(episodeNumber))
        ]) ].sort((a, b) => a - b)
    }));

    const claimed = new Set<number>();
    const result: PlannedGrab[] = [];

    for (const grab of claiming.sort((a, b) => b.episodeNumbers.length - a.episodeNumbers.length)) {
        const own = grab.episodeNumbers.filter(episodeNumber => ! claimed.has(episodeNumber));

        if (own.length === 0) {
            continue;
        }

        own.forEach(episodeNumber => claimed.add(episodeNumber));
        result.push({ ...grab, episodeNumbers: own });
    }

    return result;
};

const GRABBABLE_STATUS: WatchStatus[] = [ WatchStatus.PENDING, WatchStatus.SEARCHING, WatchStatus.FAILED ];

/**
 * A pack replaces the single episodes in two cases: an episode cannot be found on
 * its own, or a season that is fully out has not been started yet — then one
 * torrent is better than ten searches that each have to succeed.
 *
 * A season that already has something downloading or downloaded is left alone, a
 * pack would fetch those files a second time.
 */
export const shouldUsePack = (plan: SeasonPlan, requested: number[], started: boolean) => {
    if (! plan.pack) {
        return false;
    }

    const missingAlone = requested.some(episodeNumber => {
        const episode = plan.episodes.find(v => v.episodeNumber === episodeNumber);

        return episode?.aired && ! episode.release;
    });

    return missingAlone || (plan.allAired && ! started);
};

/**
 * What one round should grab for a season, and whether a pack stands in for the
 * single episodes. Shared by the scanner and the download endpoint so the two can
 * never decide differently.
 */
export const planSeasonGrabs = async (
    watchlistId: number | null,
    plan: SeasonPlan,
    options: { episodeNumbers?: number[], usePack?: boolean } = {}
) => {
    const rows = watchlistId ? await getSeasonUnits(watchlistId, plan.seasonNumber) : [];
    const wanted = options.episodeNumbers;

    const numbers = (list: typeof rows) => {
        return list.map(row => row.episodeNumber).filter((v): v is number => v !== null);
    };

    // a show that is not on the watchlist yet has no rows, and then nothing has been
    // grabbed before: the season itself is what can be taken. this is the preview of
    // a first download, where creating the rows would be a side effect of looking
    const grabbable = rows.length > 0
        ? numbers(rows.filter(row => GRABBABLE_STATUS.includes(row.status)))
        : plan.episodes.map(episode => episode.episodeNumber);

    const requested = wanted ? grabbable.filter(episodeNumber => wanted.includes(episodeNumber)) : grabbable;

    const started = rows.some(row => row.status === WatchStatus.DOWNLOADING || row.status === WatchStatus.DOWNLOADED);
    const usePack = options.usePack ?? shouldUsePack(plan, requested, started);

    // one pack torrent brings the whole season, so it claims every episode still to
    // get — not only the ones this round happened to ask for
    const eligible = usePack ? grabbable : requested;

    return { rows, usePack, eligible, grabs: planGrabs(plan, eligible, usePack, grabbable) };
};

const seasonLabel = (seasonNumber: number) => `S${ String(seasonNumber).padStart(2, "0") }`;

const label = (seasonNumber: number, grab: PlannedGrab, packSeasons: number[]) => {
    if (grab.isPack) {
        const covered = packSeasons.length > 1
            ? `${ seasonLabel(Math.min(...packSeasons)) }-${ seasonLabel(Math.max(...packSeasons)) }`
            : seasonLabel(seasonNumber);

        return `${ covered } pack`;
    }

    return `${ seasonLabel(seasonNumber) }${ grab.episodeNumbers.map(v => `E${ String(v).padStart(2, "0") }`).join("") }`;
};

/**
 * A pack can carry more than the season it was searched for. Everything it brings
 * is claimed by its hash, whether or not those seasons are watched — the files are
 * on disk either way, and a second torrent for them would be the same data again.
 */
export const packUnitIds = async (watchlistId: number, plan: SeasonPlan, release: IndexerResult) => {
    const seasons = parseNumbering(release.title).seasons.filter(v => v !== plan.seasonNumber);
    const units = await getUnitsInSeasons(watchlistId, seasons);

    return {
        seasons: [ plan.seasonNumber, ...seasons ],
        ids: units.filter(unit => GRABBABLE_STATUS.includes(unit.status)).map(unit => unit.id)
    };
};

/**
 * Only episodes that are not already downloading or downloaded are grabbed.
 */
export const executeSeasonGrab = async (
    tmdbId: number,
    plan: SeasonPlan,
    options: { episodeNumbers?: number[], usePack?: boolean } = {}
): Promise<StartedDownload[]> => {
    const item = await ensureWatchlistItem(tmdbId, ContentType.TV);

    if (! item) {
        return [];
    }

    const { rows, grabs } = await planSeasonGrabs(item.id, plan, options);
    const started: StartedDownload[] = [];

    for (const grab of grabs) {
        const ids = rows
            .filter(row => row.episodeNumber !== null && grab.episodeNumbers.includes(row.episodeNumber))
            .map(row => row.id);

        const pack = grab.isPack
            ? await packUnitIds(item.id, plan, grab.release)
            : { seasons: [ plan.seasonNumber ], ids: [] };

        const tag = grab.isPack
            ? seasonTag(item.id, plan.seasonNumber)
            : episodeTag(ids[0]);

        const hash = await addRelease(grab.release, tag, TV_PATH);

        await markUnitsDownloading([ ...new Set([ ...ids, ...pack.ids ]) ], hash);

        started.push({
            label: label(plan.seasonNumber, grab, pack.seasons),
            title: grab.release.title,
            hash,
            episodeNumbers: grab.episodeNumbers
        });
    }

    return started;
};
