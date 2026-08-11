import PTT from "parse-torrent-title";

import { getIndexerIds, IndexerResult } from "@/lib/indexer";
import { isReleaseBlocked } from "@/lib/blocklist";
import { LanguageProfile } from "@/lib/language";
import { settingList, settingNumber, settingText } from "@/lib/settings";
import { LANGUAGES } from "@/types/language";

export type QualityProfile = {
    resolutions: string[];
    excludeKeywords: string[];
    minSeeders: number;
    maxSizeGb: number;
    // ceiling for a season pack, per episode it contains
    maxPackSizeGb: number;
    minSizeMovie: Record<string, number>;
    minSizeEpisode: Record<string, number>;
    preferredCodecs: string[];
    codecBonus: number;
    preferredLanguages: string[];
    excludeLanguages: string[];
    defaultLanguage: string;
    languageFirst: boolean;
    /**
     * Non-empty, and a release in none of these languages is not a candidate at all —
     * not a worse one. This is what the scanner runs with, and it is the whole
     * difference between the two ways a download starts: unattended it takes what was
     * asked for or nothing, while a person at the dialog sees everything and may
     * knowingly take something else.
     *
     * Usually one language. It is a list because an account may say that every language
     * on its list is acceptable, and because a watchlist row may name one of its own —
     * see `searchLanguages`. Order still matters for the scoring, not here.
     */
    requireLanguages: string[];
    indexerPriority: string[];
};

/**
 * What the release is supposed to be. Without this a fake upload only has to put
 * the right words in its name to be picked.
 */
export type ReleaseTarget = {
    titles: string[];
    kind: "movie" | "episode" | "pack";
    year?: string | null;
    episodeCount?: number;
    // ISO 639-1 from TMDB: a release in the original language is never language filtered
    originalLanguage?: string | null;
};

export type ReleaseNumbering = {
    seasons: number[];
    episodes: number[];
};

export type ScoredRelease = {
    release: IndexerResult;
    score: number;
    resolution: string | null;
};

export type RejectedRelease = {
    release: IndexerResult;
    reason: string;
};

export type ReleaseSelection = {
    picked: ScoredRelease | null;
    candidates: ScoredRelease[];
    rejected: RejectedRelease[];
};

const GB = 1024 * 1024 * 1024;

const list = (value: string) => value.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);

const parseSizeTable = (value: string): Record<string, number> => {
    const table: Record<string, number> = {};

    for (const entry of value.split(",")) {
        const [ resolution, gb ] = entry.split(":");

        if (resolution && gb) {
            table[resolution.trim().toLowerCase()] = Number(gb);
        }
    }

    return table;
};

/**
 * Read fresh on every call rather than captured once — a value saved on the admin page
 * has to take effect on the next search, not on the next restart.
 *
 * The quality half is the install's and the language half is the requester's, which is
 * why the languages are handed in rather than read here: one search runs for one
 * person's rules, and the same title searched for somebody else is a different search.
 */
export const getQualityProfile = (language: LanguageProfile, requireLanguages: string[] = []): QualityProfile => {
    const priority = settingList("INDEXER_PRIORITY").map(v => v.toLowerCase());

    return {
        resolutions: list(settingText("QUALITY_RESOLUTIONS")),
        excludeKeywords: list(settingText("QUALITY_EXCLUDE")),
        minSeeders: settingNumber("QUALITY_MIN_SEEDERS"),
        maxSizeGb: settingNumber("QUALITY_MAX_SIZE_GB"),
        maxPackSizeGb: settingNumber("QUALITY_MAX_PACK_SIZE_PER_EPISODE_GB"),
        minSizeMovie: parseSizeTable(settingText("QUALITY_MIN_SIZE_MOVIE")),
        minSizeEpisode: parseSizeTable(settingText("QUALITY_MIN_SIZE_EPISODE")),
        preferredCodecs: list(settingText("QUALITY_PREFERRED_CODECS")),
        codecBonus: settingNumber("QUALITY_CODEC_BONUS"),
        // a language that was asked for outright cannot also be excluded: the exclude
        // list is about what nobody wants, and this one was named on purpose
        preferredLanguages: language.preferred,
        excludeLanguages: language.exclude.filter(entry => ! requireLanguages.includes(entry)),
        defaultLanguage: language.untagged,
        languageFirst: language.first,
        requireLanguages,
        // the order of INDEXER_IDS is the priority unless INDEXER_PRIORITY overrides it
        indexerPriority: priority.length > 0 ? priority : getIndexerIds()
    };
};

export const parseCodec = (title: string): string | null => {
    const parsed = PTT.parse(title) as { codec?: string };

    if (parsed.codec) {
        return String(parsed.codec).toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    const match = title.match(/(x264|h\.?264|avc|x265|h\.?265|hevc|av1|xvid|divx)/i);

    return match ? match[1].toLowerCase().replace(/[^a-z0-9]/g, "") : null;
};

export const normalizeTitle = (title: string) => {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
};

/**
 * PTT leaves the season marker in the title when nothing follows it that it
 * recognises as metadata — "Ted Lasso S01 1080p" parses as "Ted Lasso S01". That
 * looked like a different show and threw away most season packs, so a trailing
 * marker is cut off here. Anything after it is release noise, never part of a name.
 */
const SEASON_MARKER = /s\d{1,2}(?:[\s._-]*-[\s._-]*s?\d{1,2})?(?:[\s._-]*e\d{1,3})?|season[\s._-]*\d{1,2}/.source;
const SEASON_SUFFIX = new RegExp(`[\\s._-]+(?:(?:${ SEASON_MARKER })(?:[\\s._-]+complete)?|complete)\\s*$`, "i");

const releaseTitleOf = (title: string, parsed: { title?: string }) => {
    return (parsed.title || title).replace(SEASON_SUFFIX, "");
};

/**
 * The release name has to be about the requested title, not merely contain it —
 * "The Odyssey The Making Of An Epic" is a different film.
 */
const matchesTarget = (title: string, target: ReleaseTarget): string | null => {
    const parsed = PTT.parse(title) as { title?: string, year?: number };
    const releaseTitle = normalizeTitle(releaseTitleOf(title, parsed));
    const accepted = target.titles.map(normalizeTitle).filter(Boolean);

    if (accepted.length > 0 && ! accepted.includes(releaseTitle)) {
        return `title mismatch: "${ releaseTitleOf(title, parsed) }"`;
    }

    if (target.kind === "movie" && target.year && parsed.year && Math.abs(parsed.year - Number(target.year)) > 1) {
        return `year mismatch: ${ parsed.year } instead of ${ target.year }`;
    }

    return null;
};

const minSizeGb = (resolution: string | null, profile: QualityProfile, target?: ReleaseTarget) => {
    const table = target?.kind === "movie" || ! target ? profile.minSizeMovie : profile.minSizeEpisode;

    // an unknown resolution still has to clear the smallest floor
    const values = Object.values(table);
    const floor = resolution && table[resolution] !== undefined
        ? table[resolution]
        : Math.min(...(values.length > 0 ? values : [ 0 ]));

    return target?.kind === "pack" ? floor * Math.max(target.episodeCount || 1, 1) : floor;
};

/**
 * PTT misses some naming styles, so the title is checked as well.
 */
export const parseResolution = (title: string): string | null => {
    const parsed = PTT.parse(title);

    if (parsed.resolution) {
        const resolution = String(parsed.resolution).toLowerCase();

        if (resolution.includes("2160") || resolution === "4k") {
            return "2160p";
        }

        return resolution;
    }

    if (/(^|[^a-z0-9])(2160p|4k|uhd)([^a-z0-9]|$)/i.test(title)) {
        return "2160p";
    }

    if (/1080p/i.test(title)) {
        return "1080p";
    }

    if (/720p/i.test(title)) {
        return "720p";
    }

    if (/480p/i.test(title)) {
        return "480p";
    }

    return null;
};

const range = (from: number, to: number) => {
    const out: number[] = [];

    for (let i = from; i <= to && i - from < 500; i++) {
        out.push(i);
    }

    return out;
};

/**
 * Season and episode numbers from a release name. PTT only reports a season when
 * an episode is attached (`S01E01`) or when it is spelled out, so a bare `S01`
 * pack would look like an unnumbered release — hence this parser.
 * An empty `episodes` list means the release covers whole seasons.
 */
export const parseNumbering = (title: string): ReleaseNumbering => {
    const episodeRange = title.match(/(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,3})[\s._-]*-[\s._-]*e?(\d{1,3})(?![0-9])/i);

    if (episodeRange) {
        return {
            seasons: [ Number(episodeRange[1]) ],
            episodes: range(Number(episodeRange[2]), Number(episodeRange[3]))
        };
    }

    const withEpisodes = [ ...title.matchAll(/(?:^|[^a-z0-9])s(\d{1,2})((?:[\s._-]*e\d{1,3})+)/gi) ];

    if (withEpisodes.length > 0) {
        const seasons = new Set<number>();
        const episodes = new Set<number>();

        for (const match of withEpisodes) {
            seasons.add(Number(match[1]));

            for (const episode of match[2].matchAll(/e(\d{1,3})/gi)) {
                episodes.add(Number(episode[1]));
            }
        }

        return { seasons: [ ...seasons ], episodes: [ ...episodes ] };
    }

    const crossFormat = title.match(/(?:^|[^a-z0-9])(\d{1,2})x(\d{1,3})(?![0-9])/i);

    if (crossFormat) {
        return { seasons: [ Number(crossFormat[1]) ], episodes: [ Number(crossFormat[2]) ] };
    }

    const seasonRange = title.match(/(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*-[\s._-]*s?(\d{1,2})(?![0-9])/i);

    if (seasonRange) {
        return { seasons: range(Number(seasonRange[1]), Number(seasonRange[2])), episodes: [] };
    }

    const spelled = title.match(/(?:^|[^a-z0-9])(?:seasons?|series)[\s._-]*(\d{1,2})(?:[\s._-]*-[\s._-]*(\d{1,2}))?(?![0-9])/i);

    if (spelled) {
        const from = Number(spelled[1]);

        return { seasons: spelled[2] ? range(from, Number(spelled[2])) : [ from ], episodes: [] };
    }

    const bare = [ ...title.matchAll(/(?:^|[^a-z0-9])s(\d{1,2})(?![0-9e])/gi) ];

    return { seasons: bare.map(match => Number(match[1])), episodes: [] };
};

const hasKeyword = (title: string, keyword: string) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return new RegExp(`(^|[^a-z0-9])${ escaped }([^a-z0-9]|$)`, "i").test(title);
};

/**
 * What to look for in a title, per language. Two letter codes are deliberately not in
 * here — "Dan in Real Life" is not a Danish release — which is also why the app stores the
 * three letter form.
 *
 * Both tables are derived from [the catalogue](src/types/language.ts) rather than written
 * out here, because the account page now offers that same list to pick from: two copies of
 * it would mean a language somebody can choose and no release can ever match.
 */
const LANGUAGE_ALIASES: Record<string, string[]> = Object.fromEntries(
    LANGUAGES.map(entry => [ entry.code, [ entry.code, ...entry.aliases ] ])
);

// the other direction, and the only place a two letter code is read: TMDB reports a
// title's original language that way
const ISO_639_1: Record<string, string> = Object.fromEntries(
    LANGUAGES.map(entry => [ entry.iso1, entry.code ])
);

/**
 * Language tags sit after the title, so only that part is scanned — otherwise a
 * word in the title itself could be read as a language.
 */
const tagSection = (title: string) => {
    const marker = title.match(/(?:^|[^a-z0-9])((?:19|20)\d{2}|\d{3,4}p|s\d{1,2}(?:[\s._-]*e\d{1,3})?)(?![a-z0-9])/i);

    return marker?.index !== undefined ? title.slice(marker.index + marker[0].length) : title;
};

export const parseLanguages = (title: string): string[] => {
    const section = tagSection(title);

    return Object.keys(LANGUAGE_ALIASES).filter(code => {
        return LANGUAGE_ALIASES[code].some(alias => hasKeyword(section, alias));
    });
};

export type LanguageRating = {
    languages: string[];
    rank: number;
    excluded: string | null;
};

/**
 * What a release is in, as far as anything can tell from its name. An untagged one is
 * whatever the person says untagged means — usually English, and usually right.
 */
export const effectiveLanguages = (title: string, profile: { defaultLanguage: string }) => {
    const languages = parseLanguages(title);

    return languages.length > 0 ? languages : [ profile.defaultLanguage ];
};

/**
 * Which edition a download becomes once it is taken. A release tagged with several
 * languages counts as the best one the requester wanted — a `HUN.ENG` file is the
 * Hungarian copy for somebody whose first language is Hungarian, and it is not going
 * to be fetched a second time for the English in it.
 *
 * What was *asked for* comes first, ahead of the account's usual order: a row that named
 * German becomes the German copy even for somebody whose list has never heard of German,
 * or the row would be answered by a download that does not count as its answer.
 */
export const releaseLanguage = (title: string, profile: QualityProfile) => {
    const languages = effectiveLanguages(title, profile);

    const wanted = profile.requireLanguages.find(language => languages.includes(language))
        || profile.preferredLanguages.find(language => languages.includes(language));

    return wanted || languages[0];
};

/**
 * An untagged release is assumed to be in the default language, and a release in
 * the title's own original language is always allowed — otherwise a fixed exclude
 * list would drop every japanese or french film's own release.
 */
export const rateLanguage = (title: string, profile: QualityProfile, target?: ReleaseTarget): LanguageRating => {
    const languages = parseLanguages(title);
    const effective = effectiveLanguages(title, profile);

    const original = target?.originalLanguage
        ? ISO_639_1[target.originalLanguage.toLowerCase()] || target.originalLanguage.toLowerCase()
        : null;

    const rank = effective.reduce((best, language) => {
        const index = profile.preferredLanguages.indexOf(language);

        return index < 0 ? best : Math.max(best, profile.preferredLanguages.length - index);
    }, 0);

    if (rank > 0 || (original && effective.includes(original))) {
        return { languages, rank, excluded: null };
    }

    return { languages, rank, excluded: effective.find(v => profile.excludeLanguages.includes(v)) || null };
};

/**
 * The scoring, and why it has no weights to set any more.
 *
 * It used to be a sum of tunable bonuses — a language bonus, an indexer priority weight —
 * and that made every question about it unanswerable. "What does 100000 mean?" has no
 * answer without knowing every other number in the formula, and the only two answers
 * anybody ever wants are *always* and *never*: either the preferred indexer wins at equal
 * quality or it does not, either your language wins or it does not. A number that has to
 * be large enough is a number that is wrong for somebody.
 *
 * So the signals are **strict tiers**: nothing below a tier can add up to one step of it.
 * A rank is capped at 99 — a hundred resolutions, languages or indexers is not a real
 * install — and the last tier is the seeder count, which is where the codec bonus also
 * lives, because that one *is* expressed in seeders and has a reference frame.
 */
const RANK_CAP = 99;
const TIER = RANK_CAP + 1;

const SEEDER_CAP = 99999;

// seeders and the codec bonus share the bottom tier, so it has to hold both
const TAIL_SPAN = 2 * (SEEDER_CAP + 1);

const capped = (rank: number) => Math.min(Math.max(rank, 0), RANK_CAP);

/**
 * Resolution, language, indexer priority, seeders — with the first two swapped when the
 * requester asked for their language to come first. A widely supported codec is worth a
 * fixed number of seeders, so h264 wins unless another release has clearly more peers.
 */
const score = (release: IndexerResult, resolution: string | null, profile: QualityProfile, languageRank: number) => {
    const resolutionRank = resolution ? profile.resolutions.length - profile.resolutions.indexOf(resolution) : 0;

    const indexerIndex = profile.indexerPriority.indexOf(release.indexerId);
    const indexerRank = indexerIndex < 0 ? 0 : profile.indexerPriority.length - indexerIndex;

    const codec = parseCodec(release.title);
    // the bonus is denominated in seeders, so it cannot be worth more than every seeder
    // there is — otherwise it would reach into the tier above and stop being a tie-breaker
    const codecBonus = codec && profile.preferredCodecs.includes(codec) ? Math.min(profile.codecBonus, SEEDER_CAP) : 0;

    const ordered = profile.languageFirst
        ? [ languageRank, resolutionRank, indexerRank ]
        : [ resolutionRank, languageRank, indexerRank ];

    const tiers = ordered.reduce((sum, rank) => sum * TIER + capped(rank), 0);

    return tiers * TAIL_SPAN + Math.min(release.seeders, SEEDER_CAP) + codecBonus;
};

export const rateRelease = (release: IndexerResult, profile: QualityProfile, target?: ReleaseTarget): ScoredRelease | RejectedRelease => {
    if (! release.link) {
        return { release, reason: "no download link" };
    }

    // it was grabbed once already and had to be thrown away: it either stood still
    // until it was given up on, or what came down was not the release at all
    if (isReleaseBlocked(normalizeTitle(release.title))) {
        return { release, reason: "already tried and dropped" };
    }

    if (release.seeders < profile.minSeeders) {
        return { release, reason: `${ release.seeders } seeders` };
    }

    if (profile.maxSizeGb > 0 && release.size > profile.maxSizeGb * GB) {
        return { release, reason: `${ (release.size / GB).toFixed(1) }GB is over the limit` };
    }

    const excluded = profile.excludeKeywords.find(keyword => hasKeyword(release.title, keyword));

    if (excluded) {
        return { release, reason: `excluded keyword: ${ excluded }` };
    }

    if (target) {
        const mismatch = matchesTarget(release.title, target);

        if (mismatch) {
            return { release, reason: mismatch };
        }
    }

    const language = rateLanguage(release.title, profile, target);

    if (language.excluded) {
        return { release, reason: `language ${ language.excluded } not wanted` };
    }

    // the unattended path: the wrong language is not a worse release here, it is a
    // different film to this person, and taking it would end their search for the one
    // they actually asked for
    if (profile.requireLanguages.length > 0) {
        const languages = effectiveLanguages(release.title, profile);

        if (! languages.some(language => profile.requireLanguages.includes(language))) {
            return { release, reason: `not in ${ profile.requireLanguages.join(" or ") }` };
        }
    }

    const resolution = parseResolution(release.title);

    // an unwanted resolution is dropped, an unknown one stays as a last resort
    if (resolution && ! profile.resolutions.includes(resolution)) {
        return { release, reason: `resolution ${ resolution } not wanted` };
    }

    const floor = minSizeGb(resolution, profile, target);

    if (floor > 0 && release.size < floor * GB) {
        return {
            release,
            reason: `${ (release.size / GB).toFixed(2) }GB is too small for ${ resolution || "unknown resolution" } (min ${ floor }GB)`
        };
    }

    return { release, resolution, score: score(release, resolution, profile, language.rank) };
};

const isScored = (value: ScoredRelease | RejectedRelease): value is ScoredRelease => {
    return (value as ScoredRelease).score !== undefined;
};

export const selectRelease = (
    releases: IndexerResult[],
    profile: QualityProfile,
    target?: ReleaseTarget
): ReleaseSelection => {
    const candidates: ScoredRelease[] = [];
    const rejected: RejectedRelease[] = [];

    for (const release of releases) {
        const rated = rateRelease(release, profile, target);

        if (isScored(rated)) {
            candidates.push(rated);
        } else {
            rejected.push(rated);
        }
    }

    candidates.sort((a, b) => b.score - a.score);

    return { picked: candidates[0] || null, candidates, rejected };
};

export const filterEpisodeReleases = (releases: IndexerResult[], season: number, episode: number): IndexerResult[] => {
    return releases.filter(release => {
        const numbering = parseNumbering(release.title);

        return numbering.seasons.includes(season) && numbering.episodes.includes(episode);
    });
};

export const selectEpisodeRelease = (
    releases: IndexerResult[],
    season: number,
    episode: number,
    profile: QualityProfile,
    titles: string[] = [],
    originalLanguage?: string | null
): ReleaseSelection => {
    return selectRelease(filterEpisodeReleases(releases, season, episode), profile, {
        titles,
        kind: "episode",
        originalLanguage
    });
};

/**
 * Season packs: the requested season without single episode numbers. Used when the
 * indexer only carries the whole season.
 */
export const filterSeasonReleases = (releases: IndexerResult[], season: number): IndexerResult[] => {
    return releases.filter(release => {
        const numbering = parseNumbering(release.title);

        return numbering.episodes.length === 0 && numbering.seasons.includes(season);
    });
};

export const selectSeasonRelease = (
    releases: IndexerResult[],
    season: number,
    episodeCount: number,
    profile: QualityProfile,
    titles: string[] = [],
    originalLanguage?: string | null
): ReleaseSelection => {
    // both limits are per episode, so a pack is allowed to be that much bigger. the
    // pack ceiling is on by default: without one a single "grab the whole season"
    // decision can pull in a 200GB remux
    const episodes = Math.max(episodeCount, 1);
    const caps = [ profile.maxSizeGb, profile.maxPackSizeGb ].filter(v => v > 0).map(v => v * episodes);

    const packProfile: QualityProfile = {
        ...profile,
        maxSizeGb: caps.length > 0 ? Math.min(...caps) : 0
    };

    return selectRelease(filterSeasonReleases(releases, season), packProfile, {
        titles,
        kind: "pack",
        episodeCount,
        originalLanguage
    });
};
