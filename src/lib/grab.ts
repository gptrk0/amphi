import { ContentType, WatchStatus } from "../../prisma/generated/client";
import { findEpisodeReleases, findMovieReleases, findSeasonReleases, IndexerResult } from "@/lib/indexer";
import { getImdbId, getMediaMetadata, getTvSeasons } from "@/lib/media";
import { getQualityProfile, selectEpisodeRelease, selectRelease, selectSeasonRelease } from "@/lib/release";
import { addRelease, episodeTag, movieTag, seasonTag } from "@/lib/torrent";
import {
    addToWatchlist,
    ensureMovieUnit,
    getSeasonUnits,
    markUnitsDownloading
} from "@/lib/watchlist";

export type EpisodePlan = {
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
    episodes: EpisodePlan[];
    missing: number[];
};

export type MoviePlan = {
    release: IndexerResult | null;
    resultCount: number;
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

    return { release: selection.picked?.release || null, resultCount: releases.length };
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
    options: { episodeNumbers?: number[], force?: boolean } = {}
): Promise<SeasonPlan | null> => {
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

        // `aired` keeps saying what TMDB says — only the search is forced, so the
        // pack rules below still reason about the real state of the season
        if (! aired && ! options.force) {
            return { episodeNumber, aired, release: null };
        }

        const own = options.episodeNumbers && ! options.episodeNumbers.includes(episodeNumber)
            ? []
            : await findEpisodeReleases({ imdbId, title: metadata.original_name, season: seasonNumber, episode: episodeNumber });

        const pool = own.length > 0 ? own : releases;
        const picked = selectEpisodeRelease(pool, seasonNumber, episodeNumber, profile, titles, metadata.original_language).picked;

        return { episodeNumber, aired, release: picked ? picked.release : null };
    });

    // always looked up, not only when an episode is missing: a season that is fully
    // out is worth taking as one torrent even if every episode is there on its own
    const pack = selectSeasonRelease(releases, seasonNumber, season.episodes.length, profile, titles, metadata.original_language).picked?.release || null;

    // with a pack in hand everything already aired is obtainable, whether or not the
    // pack ends up being the one that is grabbed
    const missing = pack
        ? episodes.filter(episode => ! episode.aired).map(episode => episode.episodeNumber)
        : episodes.filter(episode => ! episode.release).map(episode => episode.episodeNumber);

    const allAired = episodes.length > 0 && episodes.every(episode => episode.aired);

    return { seasonNumber, episodeCount: season.episodes.length, allAired, pack, episodes, missing };
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
    const hash = await addRelease(release, movieTag(item.id));

    await markUnitsDownloading([ unit.id ], hash);

    return { label: "movie", title: release.title, hash, episodeNumbers: [] };
};

/**
 * Groups the episodes by the release that was picked for them: one multi episode
 * release (`S03E01-E06`) must be added once, not once per episode.
 */
export const planGrabs = (plan: SeasonPlan, eligible: number[], usePack: boolean): PlannedGrab[] => {
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

    return [ ...grabs.values() ];
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
    watchlistId: number,
    plan: SeasonPlan,
    options: { episodeNumbers?: number[], usePack?: boolean } = {}
) => {
    const rows = await getSeasonUnits(watchlistId, plan.seasonNumber);
    const wanted = options.episodeNumbers;

    const numbers = (list: typeof rows) => {
        return list.map(row => row.episodeNumber).filter((v): v is number => v !== null);
    };

    const grabbable = rows.filter(row => GRABBABLE_STATUS.includes(row.status));
    const requested = wanted
        ? grabbable.filter(row => row.episodeNumber !== null && wanted.includes(row.episodeNumber))
        : grabbable;

    const started = rows.some(row => row.status === WatchStatus.DOWNLOADING || row.status === WatchStatus.DOWNLOADED);
    const usePack = options.usePack ?? shouldUsePack(plan, numbers(requested), started);

    // one pack torrent brings the whole season, so it claims every episode still to
    // get — not only the ones this round happened to ask for
    const eligible = numbers(usePack ? grabbable : requested);

    return { rows, usePack, grabs: planGrabs(plan, eligible, usePack) };
};

const label = (seasonNumber: number, grab: PlannedGrab) => {
    const season = `S${ String(seasonNumber).padStart(2, "0") }`;

    if (grab.isPack) {
        return `${ season } pack`;
    }

    return `${ season }${ grab.episodeNumbers.map(v => `E${ String(v).padStart(2, "0") }`).join("") }`;
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

        const tag = grab.isPack
            ? seasonTag(item.id, plan.seasonNumber)
            : episodeTag(ids[0]);

        const hash = await addRelease(grab.release, tag);

        await markUnitsDownloading(ids, hash);

        started.push({
            label: label(plan.seasonNumber, grab),
            title: grab.release.title,
            hash,
            episodeNumbers: grab.episodeNumbers
        });
    }

    return started;
};
