import { IndexerResult } from "@/lib/indexer";
import { hasLibraryItem, heldEpisodes } from "@/lib/library";
import {
    audience,
    executeMovieGrab,
    executeSeasonGrab,
    GrabContext,
    MoviePlan,
    planMovieGrab,
    planSeasonGrab,
    planSeasonGrabs,
    SeasonPlan,
    StartedDownload
} from "@/lib/grab";
import { effectiveLanguages, parseResolution, QualityProfile } from "@/lib/release";
import { settingNumber } from "@/lib/settings";
import { DownloadPreview, GrabChoice, GrabOption, MissingSeason } from "@/types/download";

export type SeasonRequest = {
    seasonNumber: number;
    episodeNumbers: number[];
};

/**
 * `seasons` is either a list of season numbers (the whole season) or a list of
 * `{ seasonNumber, episodeNumbers }` — an empty episode list also means the whole
 * season.
 */
export const toSeasonRequests = (value: unknown): SeasonRequest[] => {
    if (! Array.isArray(value)) {
        return [];
    }

    return value
        .map(entry => {
            const object = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : null;
            const seasonNumber = Number(object ? object.seasonNumber : entry);
            const episodes = object ? object.episodeNumbers : null;

            return {
                seasonNumber,
                episodeNumbers: Array.isArray(episodes) ? episodes.map(Number).filter(v => ! Number.isNaN(v)) : []
            };
        })
        .filter(entry => ! Number.isNaN(entry.seasonNumber));
};

type StoredSeason = {
    request: SeasonRequest;
    plan: SeasonPlan;
    usePack: boolean;
};

type StoredPlan = {
    id: string;
    tmdbId: number;
    type: "movie" | "tv";
    createdAt: number;
    movie: MoviePlan | null;
    seasons: StoredSeason[];
    missing: MissingSeason[];
    missingMovie: boolean;
    // whose search this was: kept so that answering the dialog cannot land in a
    // different person's library than the one the releases were found for
    context: GrabContext;
};

// A search costs tens of seconds, so the plan behind a dialog is kept instead of
// being made again when the choice comes back. It only has to outlive the dialog.
const ttlMs = () => settingNumber("DOWNLOAD_PLAN_TTL_MINUTES") * 60 * 1000;
const MAX_PLANS = 20;

const globalForPlans = global as unknown as { downloadPlans: Map<string, StoredPlan> };
const plans = globalForPlans.downloadPlans || new Map<string, StoredPlan>();
globalForPlans.downloadPlans = plans;

const remember = (plan: StoredPlan) => {
    for (const [ id, stored ] of plans) {
        if (stored.createdAt + ttlMs() < Date.now()) {
            plans.delete(id);
        }
    }

    while (plans.size >= MAX_PLANS) {
        plans.delete(plans.keys().next().value as string);
    }

    plans.set(plan.id, plan);
};

export const getStoredPlan = (id: string) => {
    const plan = plans.get(id);

    if (! plan) {
        return null;
    }

    return plan.createdAt + ttlMs() < Date.now() ? null : plan;
};

const toOption = (release: IndexerResult, profile: QualityProfile): GrabOption => {
    return {
        guid: release.guid || release.link,
        title: release.title,
        size: release.size,
        seeders: release.seeders,
        resolution: parseResolution(release.title),
        // the release name is the only place this exists, and it is the difference
        // between the film somebody wanted and the same film they cannot watch
        languages: effectiveLanguages(release.title, profile),
        indexer: release.indexerId
    };
};

const episodeLabel = (seasonNumber: number, episodeNumber: number) => {
    return `S${ String(seasonNumber).padStart(2, "0") }E${ String(episodeNumber).padStart(2, "0") }`;
};

/**
 * One line per thing that would be downloaded: the pack if the season is taken as
 * one torrent, otherwise every episode that has something to offer. Episodes with
 * nothing found are not lines to choose from, they are the missing list.
 */
const seasonChoices = (season: StoredSeason, profile: QualityProfile): GrabChoice[] => {
    const { plan, usePack } = season;

    if (usePack && plan.pack) {
        return [ {
            key: `s${ plan.seasonNumber }`,
            label: `Season ${ plan.seasonNumber } — full pack`,
            seasonNumber: plan.seasonNumber,
            episodeNumbers: [],
            isPack: true,
            options: plan.packOptions.candidates.map(release => toOption(release, profile)),
            filtered: plan.packOptions.filtered
        } ];
    }

    const wanted = season.request.episodeNumbers;

    return plan.episodes
        .filter(episode => wanted.length === 0 || wanted.includes(episode.episodeNumber))
        .filter(episode => episode.candidates.length > 0)
        .map(episode => ({
            key: `s${ plan.seasonNumber }e${ episode.episodeNumber }`,
            label: episodeLabel(plan.seasonNumber, episode.episodeNumber),
            seasonNumber: plan.seasonNumber,
            episodeNumbers: [ episode.episodeNumber ],
            isPack: false,
            options: episode.candidates.map(release => toOption(release, profile)),
            filtered: episode.filtered
        }));
};

/**
 * Searches everything the request covers and keeps the result, so the answer to the
 * dialog can be executed without searching again.
 */
export const buildPreview = async (
    type: "movie" | "tv",
    tmdbId: number,
    seasons: SeasonRequest[],
    context: GrabContext
): Promise<DownloadPreview | null> => {
    const stored: StoredPlan = {
        id: crypto.randomUUID(),
        tmdbId,
        type,
        createdAt: Date.now(),
        movie: null,
        seasons: [],
        missing: [],
        missingMovie: false,
        context
    };

    if (type === "movie") {
        const plan = await planMovieGrab(tmdbId, context);

        if (! plan) {
            return null;
        }

        stored.movie = plan;
        stored.missingMovie = plan.candidates.length === 0;

    } else {
        for (const request of seasons) {
            const wanted = request.episodeNumbers.length > 0 ? request.episodeNumbers : undefined;
            const plan = await planSeasonGrab(tmdbId, request.seasonNumber, context, { episodeNumbers: wanted });

            if (! plan) {
                continue;
            }

            const { usePack } = await planSeasonGrabs(tmdbId, plan, context, { episodeNumbers: wanted });

            stored.seasons.push({ request, plan, usePack });

            // with a pack in hand only what has not aired is out of reach
            const gaps = wanted ? plan.missing.filter(v => wanted.includes(v)) : plan.missing;

            if (gaps.length > 0) {
                stored.missing.push({ seasonNumber: request.seasonNumber, episodeNumbers: gaps });
            }
        }
    }

    remember(stored);

    // this person's shelf, in this edition — somebody else's copy in another language
    // is not an answer, and the dialog must not pretend it is
    const held = audience(context);

    const choices: GrabChoice[] = stored.movie
        ? (stored.movie.candidates.length > 0 ? [ {
            key: "movie",
            label: "Movie",
            seasonNumber: null,
            episodeNumbers: [],
            isPack: false,
            options: stored.movie.candidates.map(release => toOption(release, context.profile)),
            filtered: stored.movie.filtered
        } ] : [])
        : stored.seasons.flatMap(season => seasonChoices(season, context.profile));

    /**
     * What this person already has in this edition.
     *
     * The two halves behave differently on purpose. **Episodes are dropped from the
     * dialog**: the grab refuses to fetch a held episode anyway, so offering it would
     * be a line that quietly does nothing. **A film is kept**, because a second copy
     * is a thing the grab will actually do — and sometimes wanted, when the first one
     * is a bad rip. It is only stated plainly first.
     */
    const heldKeys = new Set<string>();

    if (stored.movie) {
        if (await hasLibraryItem(tmdbId, held)) {
            heldKeys.add("movie");
        }

    } else {
        const episodes = await heldEpisodes(tmdbId, held);

        for (const choice of choices) {
            const covered = choice.isPack
                ? stored.seasons.find(season => season.plan.seasonNumber === choice.seasonNumber)?.plan.episodes.map(episode => episode.episodeNumber) || []
                : choice.episodeNumbers;

            if (covered.length > 0 && covered.every(number => episodes.has(`${ choice.seasonNumber }:${ number }`))) {
                heldKeys.add(choice.key);
            }
        }
    }

    const heldLabels = choices.filter(choice => heldKeys.has(choice.key)).map(choice => choice.label);
    const offered = stored.movie ? choices : choices.filter(choice => ! heldKeys.has(choice.key));

    const filtered = stored.movie
        ? stored.movie.filtered
        : stored.seasons.reduce((sum, season) => {
            const episodes = season.plan.episodes.reduce((count, episode) => count + episode.filtered, 0);

            return sum + episodes + season.plan.packOptions.filtered;
        }, 0);

    // Asked of every line, not of the request as a whole: an episode that exists in
    // your language and one that does not are two different answers, and taking the
    // second is a decision. The dialog turns this into the question it deserves.
    const short = offered.filter(choice => ! choice.options.some(option => option.languages.includes(context.language)));

    return {
        planId: stored.id,
        type,
        tmdbId,
        choices: offered,
        missing: stored.missing,
        missingMovie: stored.missingMovie,
        filtered,
        language: {
            primary: context.language,
            missing: short.map(choice => choice.label)
        },
        held: heldLabels
    };
};

const findByGuid = (candidates: IndexerResult[], guid: string) => {
    return candidates.find(release => (release.guid || release.link) === guid) || null;
};

/**
 * Rewrites the plan with what the user picked. Everything downstream keeps working
 * on a plan, so a chosen release is simply the release the plan now holds — the
 * grouping of episodes onto torrents stays exactly the same.
 */
export const applyPicks = (plan: StoredPlan, picks: Record<string, string>) => {
    if (plan.movie) {
        const chosen = picks.movie ? findByGuid(plan.movie.candidates, picks.movie) : null;

        if (chosen) {
            plan.movie.release = chosen;
        }

        return;
    }

    for (const season of plan.seasons) {
        const packPick = picks[`s${ season.plan.seasonNumber }`];
        const chosenPack = packPick ? findByGuid(season.plan.packOptions.candidates, packPick) : null;

        if (chosenPack) {
            season.plan.pack = chosenPack;
        }

        for (const episode of season.plan.episodes) {
            const pick = picks[`s${ season.plan.seasonNumber }e${ episode.episodeNumber }`];
            const chosen = pick ? findByGuid(episode.candidates, pick) : null;

            if (chosen) {
                episode.release = chosen;
            }
        }
    }
};

export const executeStoredPlan = async (
    plan: StoredPlan,
    picks: Record<string, string>,
    // whoever answered the dialog. On an instant download this is the only record of
    // who wanted it — there is no watchlist row to read it off
    requestedBy: number | null = null
): Promise<StartedDownload[]> => {
    applyPicks(plan, picks);

    if (plan.movie) {
        if (! plan.movie.release) {
            return [];
        }

        const started = await executeMovieGrab(plan.tmdbId, plan.movie.release, plan.context, requestedBy);

        return started ? [ started ] : [];
    }

    const started: StartedDownload[] = [];

    for (const season of plan.seasons) {
        const wanted = season.request.episodeNumbers.length > 0 ? season.request.episodeNumbers : undefined;

        started.push(...await executeSeasonGrab(plan.tmdbId, season.plan, plan.context, {
            episodeNumbers: wanted,
            // the dialog was built for this decision, so it must not change under it
            usePack: season.usePack,
            requestedBy
        }));
    }

    return started;
};
