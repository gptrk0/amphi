import PTT from "parse-torrent-title";

import { getIndexerIds, IndexerResult } from "@/lib/indexer";
import { isTitleBlocked } from "@/lib/stall";

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
    languageBonus: number;
    languageFirst: boolean;
    indexerPriority: string[];
    indexerBonus: number;
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

const DEFAULT_RESOLUTIONS = "1080p,720p,2160p";
const DEFAULT_EXCLUDES = "cam,camrip,hdcam,ts,telesync,hdts,telecine,tc,workprint,screener,scr,exe,msi,apk";

// A file this much smaller than the claimed resolution is not that video.
const DEFAULT_MIN_SIZE_MOVIE = "2160p:8,1080p:2,720p:0.8,480p:0.3";
const DEFAULT_MIN_SIZE_EPISODE = "2160p:1.5,1080p:0.4,720p:0.15,480p:0.05";

// h264 plays everywhere; hevc/av1 are a fallback
const DEFAULT_PREFERRED_CODECS = "x264,h264,avc";

// first one wins; an untagged release counts as DEFAULT_LANGUAGE
const DEFAULT_PREFERRED_LANGUAGES = "hun,eng";
const DEFAULT_LANGUAGE = "eng";

// only applies when the release is neither preferred nor in the original language
const DEFAULT_EXCLUDE_LANGUAGES = [
    "ita", "ger", "fre", "spa", "por", "rus", "pol", "cze", "slo", "tur", "ara",
    "hin", "tam", "tel", "kor", "jpn", "chi", "tha", "vie", "ukr", "rum", "bul",
    "dut", "swe", "nor", "dan", "fin", "gre", "heb", "per", "ind"
].join(",");

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

export const getQualityProfile = (): QualityProfile => {
    return {
        resolutions: list(process.env.QUALITY_RESOLUTIONS || DEFAULT_RESOLUTIONS),
        excludeKeywords: list(process.env.QUALITY_EXCLUDE || DEFAULT_EXCLUDES),
        minSeeders: Number(process.env.QUALITY_MIN_SEEDERS || 1),
        maxSizeGb: Number(process.env.QUALITY_MAX_SIZE_GB || 0),
        maxPackSizeGb: Number(process.env.QUALITY_MAX_PACK_SIZE_PER_EPISODE_GB || 5),
        minSizeMovie: parseSizeTable(process.env.QUALITY_MIN_SIZE_MOVIE || DEFAULT_MIN_SIZE_MOVIE),
        minSizeEpisode: parseSizeTable(process.env.QUALITY_MIN_SIZE_EPISODE || DEFAULT_MIN_SIZE_EPISODE),
        preferredCodecs: list(process.env.QUALITY_PREFERRED_CODECS || DEFAULT_PREFERRED_CODECS),
        codecBonus: Number(process.env.QUALITY_CODEC_BONUS || 500),
        preferredLanguages: list(process.env.QUALITY_PREFERRED_LANGUAGES || DEFAULT_PREFERRED_LANGUAGES),
        excludeLanguages: list(process.env.QUALITY_EXCLUDE_LANGUAGES || DEFAULT_EXCLUDE_LANGUAGES),
        defaultLanguage: (process.env.QUALITY_DEFAULT_LANGUAGE || DEFAULT_LANGUAGE).trim().toLowerCase(),
        languageBonus: Number(process.env.QUALITY_LANGUAGE_BONUS || 1000000),
        // 1 = language outranks resolution (720p hun over 1080p eng)
        languageFirst: process.env.QUALITY_LANGUAGE_FIRST === "1",
        // the order of INDEXER_IDS is the priority unless INDEXER_PRIORITY overrides it
        indexerPriority: (process.env.INDEXER_PRIORITY || "").split(",").map(v => v.trim()).filter(Boolean).length > 0
            ? (process.env.INDEXER_PRIORITY as string).split(",").map(v => v.trim()).filter(Boolean)
            : getIndexerIds(),
        indexerBonus: Number(process.env.INDEXER_PRIORITY_BONUS || 100000)
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

// two letter codes are left out on purpose: "Dan in Real Life" is not a Danish release
const LANGUAGE_ALIASES: Record<string, string[]> = {
    hun: [ "hun", "hungarian", "magyar" ],
    eng: [ "eng", "english" ],
    ita: [ "ita", "italian", "italiano" ],
    ger: [ "ger", "deu", "german", "deutsch" ],
    fre: [ "fre", "fra", "french", "francais", "truefrench", "vff", "vfq", "vostfr" ],
    spa: [ "spa", "spanish", "espanol", "castellano", "latino" ],
    por: [ "por", "portuguese", "dublado" ],
    rus: [ "rus", "russian" ],
    pol: [ "pol", "polish", "lektor" ],
    cze: [ "cze", "ces", "czech" ],
    slo: [ "slo", "slovak" ],
    tur: [ "tur", "turkish" ],
    ara: [ "ara", "arabic" ],
    hin: [ "hin", "hindi" ],
    tam: [ "tam", "tamil" ],
    tel: [ "tel", "telugu" ],
    kor: [ "kor", "korean" ],
    jpn: [ "jpn", "jap", "japanese" ],
    chi: [ "chi", "chinese", "mandarin", "cantonese" ],
    tha: [ "tha", "thai" ],
    vie: [ "vie", "vietnamese" ],
    ukr: [ "ukr", "ukrainian" ],
    rum: [ "rum", "ron", "romanian" ],
    bul: [ "bul", "bulgarian" ],
    dut: [ "dut", "nld", "dutch" ],
    swe: [ "swe", "swedish" ],
    nor: [ "nor", "norwegian" ],
    dan: [ "dan", "danish" ],
    fin: [ "fin", "finnish" ],
    gre: [ "gre", "greek" ],
    heb: [ "heb", "hebrew" ],
    per: [ "per", "farsi", "persian" ],
    ind: [ "ind", "indonesian" ]
};

const ISO_639_1: Record<string, string> = {
    en: "eng", hu: "hun", it: "ita", de: "ger", fr: "fre", es: "spa", pt: "por",
    ru: "rus", pl: "pol", cs: "cze", sk: "slo", tr: "tur", ar: "ara", hi: "hin",
    ta: "tam", te: "tel", ko: "kor", ja: "jpn", zh: "chi", th: "tha", vi: "vie",
    uk: "ukr", ro: "rum", bg: "bul", nl: "dut", sv: "swe", no: "nor", da: "dan",
    fi: "fin", el: "gre", he: "heb", fa: "per", id: "ind"
};

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
 * An untagged release is assumed to be in the default language, and a release in
 * the title's own original language is always allowed — otherwise a fixed exclude
 * list would drop every japanese or french film's own release.
 */
export const rateLanguage = (title: string, profile: QualityProfile, target?: ReleaseTarget): LanguageRating => {
    const languages = parseLanguages(title);
    const effective = languages.length > 0 ? languages : [ profile.defaultLanguage ];

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

const RESOLUTION_WEIGHT = 1000000000;

// has to outrank any resolution, so language can be made the strongest signal
const LANGUAGE_FIRST_WEIGHT = 100000000000;

/**
 * Resolution first, then the language, then the indexer priority, then seeders. A
 * widely supported codec is worth a fixed number of seeders, so h264 wins unless
 * another release has clearly more peers.
 */
const score = (release: IndexerResult, resolution: string | null, profile: QualityProfile, languageRank: number) => {
    const rank = resolution ? profile.resolutions.length - profile.resolutions.indexOf(resolution) : 0;

    const indexerIndex = profile.indexerPriority.indexOf(release.indexerId);
    const indexerRank = indexerIndex < 0 ? 0 : profile.indexerPriority.length - indexerIndex;

    const codec = parseCodec(release.title);
    const codecBonus = codec && profile.preferredCodecs.includes(codec) ? profile.codecBonus : 0;

    const languageWeight = profile.languageFirst ? LANGUAGE_FIRST_WEIGHT : profile.languageBonus;

    return rank * RESOLUTION_WEIGHT
        + languageRank * languageWeight
        + indexerRank * profile.indexerBonus
        + Math.min(release.seeders, 99999)
        + codecBonus;
};

export const rateRelease = (release: IndexerResult, profile: QualityProfile, target?: ReleaseTarget): ScoredRelease | RejectedRelease => {
    if (! release.link) {
        return { release, reason: "no download link" };
    }

    // it was grabbed once already and had to be thrown away: it either stood still
    // until it was given up on, or what came down was not the release at all
    if (isTitleBlocked(normalizeTitle(release.title))) {
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
    profile: QualityProfile = getQualityProfile(),
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
    profile: QualityProfile = getQualityProfile(),
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
    profile: QualityProfile = getQualityProfile(),
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
