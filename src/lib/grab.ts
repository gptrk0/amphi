import { ContentType } from "../../prisma/generated/client";
import { refreshBlocklist } from "@/lib/blocklist";
import { findEpisodeReleases, findMovieReleases, findSeasonReleases, IndexerResult } from "@/lib/indexer";
import { getImdbId, getMediaMetadata, getTvSeasons, mediaTitles, RECORD_LANGUAGE } from "@/lib/media";
import { languageProfileOf, searchLanguages } from "@/lib/language";
import {
    getQualityProfile,
    parseNumbering,
    QualityProfile,
    releaseLanguage,
    ReleaseSelection,
    selectEpisodeRelease,
    selectRelease,
    selectSeasonRelease
} from "@/lib/release";
import { settingNumber, settingText } from "@/lib/settings";
import { addRelease } from "@/lib/torrent";
import { LibraryAudience } from "@/lib/audience";
import { logWarn } from "@/lib/log";
import { RejectionCode } from "@/types/download";
import {
    GrabbedEpisode,
    heldEpisodes,
    libraryTag,
    LibraryRow,
    moveToLibrary,
    restoreToWatchlist,
    rowHoldingTorrent,
    seasonStarted,
    setTorrentHash
} from "@/lib/library";

/**
 * Everything one search found, sorted into what the dialog does with it. `release` stays
 * the one the profile picked, which is what the scanner takes without asking.
 *
 * `candidates` is the short list the dialog offers up front, `extras` is the rest — the
 * accepted runners up that did not fit plus the refused ones, each with why. They are kept
 * because a person looking at the list may knowingly take one, and asking the indexers
 * again to find out costs tens of seconds.
 *
 * `filtered` is how many the profile threw away, which is a different number from
 * `extras.length` and the one worth saying when nothing is left at all.
 */
export type ReleaseOptions = {
    candidates: IndexerResult[];
    extras: ReleaseExtra[];
    filtered: number;
};

export type ReleaseExtra = {
    release: IndexerResult;
    // null when the profile accepted it and the list was simply full
    code: RejectionCode | null;
    reason: string | null;
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

/**
 * Whose search this is, which is now half of what a search *is*.
 *
 * A title is no longer looked for once for the whole house: it is looked for once per
 * set of languages somebody wants it in, and what comes back belongs to the people who
 * wanted that edition. `userIds` is who those people are — whose watchlist units this
 * grab may carry off — and `languages` is what it will accept, best first.
 *
 * Usually one language. More when an account says every language on its list will do,
 * and exactly one when a watchlist row named its own.
 *
 * The scanner builds this with a profile that **rejects** everything else, so it can only
 * ever take what was asked for. The download dialog builds it open, because a person
 * looking at the list may knowingly take something else.
 */
export type GrabContext = {
    userIds: number[];
    languages: string[];
    profile: QualityProfile;
};

/**
 * The context for a group of people who want the same title in the same languages. The
 * first one's profile stands for the group: they agree on the language, which is what a
 * search is shaped by, and the rest — the exclusions, the order — only reorders what is
 * already acceptable.
 *
 * `languages` is handed in already resolved, because the caller that has watchlist rows
 * in hand is the only one that can resolve it: two rows can land in the same group by
 * different routes — one account's primary and another's row asking for that language by
 * name — and then no single profile is the right one to ask. Without it the account's own
 * rule stands, which is what the download dialog wants.
 */
export const grabContext = async (
    userIds: number[],
    options: { strict: boolean, languages?: string[] }
): Promise<GrabContext> => {
    const profile = await languageProfileOf(userIds[0]);
    const languages = options.languages?.length ? options.languages : searchLanguages(profile);

    return {
        userIds,
        languages,
        profile: getQualityProfile(profile, options.strict ? languages : [])
    };
};

/** What a library query means for this search: these editions, or this person's own. */
export const audience = (context: GrabContext): LibraryAudience => ({
    languages: context.languages,
    userIds: context.userIds
});

// how many releases a download dialog offers to choose from
const optionCount = () => settingNumber("DOWNLOAD_OPTION_COUNT");

// Films and shows want different folders — every media server expects them apart.
// Empty leaves the destination to the qBittorrent category, as before.
const moviePath = () => settingText("TORRENT_MOVIE_PATH");
const tvPath = () => settingText("TORRENT_SERIES_PATH");

const toOptions = (selection: ReleaseSelection): ReleaseOptions => {
    const count = optionCount();

    return {
        candidates: selection.candidates.slice(0, count).map(scored => scored.release),
        extras: [
            // the accepted ones first, still in the profile's own order: they are the ones
            // it would have taken next, so they are the ones worth looking at first
            ...selection.candidates.slice(count).map(scored => ({ release: scored.release, code: null, reason: null })),
            // and then what it refused, most seeded first — the reason is on each line, so
            // the order can be about what is actually worth downloading
            ...selection.rejected
                // Two kinds are not offered at all, however far the list is opened. A
                // release with no link has nothing to download, and one under the seeder
                // minimum has nobody to download it from — neither is a choice somebody
                // could make, they are dead ends dressed as options. They still count in
                // `filtered`, because the profile did throw them away.
                .filter(rejected => rejected.code !== "no-link" && rejected.code !== "seeders")
                .sort((a, b) => b.release.seeders - a.release.seeders)
                .map(rejected => ({ release: rejected.release, code: rejected.code, reason: rejected.reason }))
        ],
        filtered: selection.rejected.length
    };
};

export type StartedDownload = {
    label: string;
    title: string;
    hash: string | null;
    episodeNumbers: number[];
    // the library row this became, which is also who to tell about it
    libraryId: number;
    watchedBy: number[];
};

/**
 * The hash the client answered with, if this row may write it down.
 *
 * It is refused when another live row is already following that torrent. Two rows on one
 * torrent is never a true statement about the library: they would both claim its name, its
 * size and its seed time, and the first deletion would take the other one's files. So the
 * grab is treated as not started — which puts the request back on the watchlist, where a
 * later round can pick a release of its own.
 */
const ownHash = async (item: LibraryRow, hash: string | null, releaseTitle: string) => {
    if (! hash) {
        return null;
    }

    const owner = await rowHoldingTorrent(hash, item.id);

    if (! owner) {
        return hash;
    }

    await logWarn(
        "download",
        `${ releaseTitle }: the client answered with a torrent that library row #${ owner.id } already follows`,
        `torrent ${ hash.slice(0, 8) } — left alone, and this request goes back on the watchlist`
    );

    return null;
};

export type PlannedGrab = {
    release: IndexerResult;
    episodeNumbers: number[];
    isPack: boolean;
};

export const planMovieGrab = async (tmdbId: number, context: GrabContext): Promise<MoviePlan | null> => {
    // scoring reads the blocklist synchronously, so it has to be in memory by then
    await refreshBlocklist();

    // pinned, not the reader's language: what gets grabbed cannot depend on whose browser
    // asked for it. Nothing read here is per language anyway — the original title, the
    // year, the original language — and the names to match against come from `mediaTitles`,
    // which knows every language the app has
    const metadata = await getMediaMetadata("movie", tmdbId, RECORD_LANGUAGE);

    if (! metadata) {
        return null;
    }

    const releases = await findMovieReleases({
        imdbId: await getImdbId("movie", tmdbId),
        title: metadata.original_name,
        year: metadata.year
    });

    const selection = selectRelease(releases, context.profile, {
        titles: await mediaTitles("movie", tmdbId),
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

const episodeConcurrency = () => settingNumber("EPISODE_SEARCH_CONCURRENCY");

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
    context: GrabContext,
    options: { episodeNumbers?: number[] } = {}
): Promise<SeasonPlan | null> => {
    await refreshBlocklist();

    const metadata = await getMediaMetadata("tv", tmdbId, RECORD_LANGUAGE);
    const seasons = await getTvSeasons(tmdbId, RECORD_LANGUAGE);
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

    const profile = context.profile;
    const titles = await mediaTitles("tv", tmdbId);
    const now = Date.now();

    const episodes: EpisodePlan[] = await mapLimited(season.episodes, episodeConcurrency(), async (episode) => {
        const episodeNumber = episode.episode_number;
        const aired = !! episode.air_date && new Date(episode.air_date).getTime() <= now;

        // An episode that has not aired is never searched for, by any caller. A
        // release that exists before the episode does cannot be the episode — this
        // is the one check a faked release name cannot get past, and skipping it is
        // how a 1.2 GB `.scr` got in as Silo S03E07 on 2026-08-08.
        if (! aired) {
            return { episodeNumber, aired, release: null, candidates: [], extras: [], filtered: 0 };
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

/**
 * A film is one download and nothing else: the moment it starts there is nothing
 * left to watch for, so it goes straight into the library and off the watchlist.
 */
export const executeMovieGrab = async (
    tmdbId: number,
    release: IndexerResult,
    context: GrabContext,
    // null when the scanner did it: then the people it belongs to are the ones whose
    // units it carries off
    requestedBy: number | null = null
): Promise<StartedDownload | null> => {
    const item = await moveToLibrary({
        tmdbId,
        type: ContentType.MOVIE,
        releaseTitle: release.title,
        episodes: [],
        // read off the release rather than taken from the search: unattended the two
        // are the same, but a person who accepted an English file at the dialog has an
        // English row, and their Hungarian search is not ended by it for anybody else
        language: releaseLanguage(release.title, context.profile),
        forUsers: context.userIds,
        requestedBy
    });

    const added = await addRelease(release, await libraryTag(item.id), moviePath());
    const hash = await ownHash(item, added, release.title);

    if (! hash) {
        await restoreToWatchlist(item);

        return null;
    }

    await setTorrentHash(item.id, hash);

    return {
        label: "movie",
        title: release.title,
        hash,
        episodeNumbers: [],
        libraryId: item.id,
        watchedBy: item.watchedBy
    };
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
    tmdbId: number,
    plan: SeasonPlan,
    context: GrabContext,
    options: { episodeNumbers?: number[], usePack?: boolean } = {}
) => {
    // What is already had or on its way is not searched for again. The watchlist no
    // longer answers this — a download takes its units with it — so the library is
    // the only record of what has been obtained. In this edition: somebody else's
    // English copy is not an answer to a Hungarian list.
    const held = await heldEpisodes(tmdbId, audience(context));
    const wanted = options.episodeNumbers;

    const grabbable = plan.episodes
        .map(episode => episode.episodeNumber)
        .filter(episodeNumber => ! held.has(`${ plan.seasonNumber }:${ episodeNumber }`));

    const requested = wanted ? grabbable.filter(episodeNumber => wanted.includes(episodeNumber)) : grabbable;

    const started = await seasonStarted(tmdbId, plan.seasonNumber, audience(context));
    const usePack = options.usePack ?? shouldUsePack(plan, requested, started);

    // one pack torrent brings the whole season, so it claims every episode still to
    // get — not only the ones this round happened to ask for
    const eligible = usePack ? grabbable : requested;

    return { usePack, eligible, grabs: planGrabs(plan, eligible, usePack, grabbable) };
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
 * Everything one grab brings. A pack can carry more than the season it was searched
 * for, and it claims those seasons too, whether or not they are watched — the files
 * are on disk either way, and a second torrent for them would be the same data
 * again. What is already had is left out of the claim.
 */
export const grabbedEpisodes = async (
    tmdbId: number,
    plan: SeasonPlan,
    grab: PlannedGrab,
    context: GrabContext
): Promise<GrabbedEpisode[]> => {
    const own = grab.episodeNumbers.map(episodeNumber => ({ seasonNumber: plan.seasonNumber, episodeNumber }));

    if (! grab.isPack) {
        return own;
    }

    const extra = parseNumbering(grab.release.title).seasons.filter(v => v !== plan.seasonNumber);

    if (extra.length === 0) {
        return own;
    }

    const held = await heldEpisodes(tmdbId, audience(context));
    const seasons = await getTvSeasons(tmdbId, RECORD_LANGUAGE);

    const carried = seasons
        .filter(season => extra.includes(season.season_number))
        .flatMap(season => season.episodes.map(episode => ({
            seasonNumber: season.season_number,
            episodeNumber: episode.episode_number
        })))
        .filter(episode => ! held.has(`${ episode.seasonNumber }:${ episode.episodeNumber }`));

    return [ ...own, ...carried ];
};

/**
 * Only episodes that are not already downloading or on disk are grabbed. Each one
 * becomes a library row before the torrent is added, so the row id can be the tag
 * the hash is read back by — and the watchlist loses what it no longer has to find.
 */
export const executeSeasonGrab = async (
    tmdbId: number,
    plan: SeasonPlan,
    context: GrabContext,
    options: { episodeNumbers?: number[], usePack?: boolean, requestedBy?: number | null } = {}
): Promise<StartedDownload[]> => {
    const { grabs } = await planSeasonGrabs(tmdbId, plan, context, options);
    const started: StartedDownload[] = [];

    for (const grab of grabs) {
        const episodes = await grabbedEpisodes(tmdbId, plan, grab, context);

        const item = await moveToLibrary({
            tmdbId,
            type: ContentType.TV,
            releaseTitle: grab.release.title,
            episodes,
            language: releaseLanguage(grab.release.title, context.profile),
            forUsers: context.userIds,
            requestedBy: options.requestedBy ?? null
        });

        const added = await addRelease(grab.release, await libraryTag(item.id), tvPath());
        const hash = await ownHash(item, added, grab.release.title);

        if (hash) {
            await setTorrentHash(item.id, hash);

        } else {
            // the client never showed the torrent, so there is nothing to follow:
            // put it back rather than leave a library row that will never finish
            await restoreToWatchlist(item);

            continue;
        }

        started.push({
            label: label(plan.seasonNumber, grab, [ ...new Set(episodes.map(episode => episode.seasonNumber)) ]),
            title: grab.release.title,
            hash,
            episodeNumbers: grab.episodeNumbers,
            libraryId: item.id,
            watchedBy: item.watchedBy
        });
    }

    return started;
};
