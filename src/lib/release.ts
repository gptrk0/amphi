import PTT from "parse-torrent-title";

import { getIndexerIds, IndexerResult } from "@/lib/indexer";
import { isReleaseBlocked } from "@/lib/blocklist";
import { LanguageProfile } from "@/lib/language";
import { settingList, settingNumber, settingText } from "@/lib/settings";
import { CheckStep, ReleaseTrace } from "@/types/diagnosis";
import { RejectionCode } from "@/types/download";
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

/**
 * `reason` is the sentence, for the log and for a person reading it there; `code` is the
 * same thing as a key, for the dialog — that one is read by somebody whose interface may
 * not be in English, and the numbers in the sentence are already on the line next to it.
 */
export type RejectedRelease = {
    release: IndexerResult;
    code: RejectionCode;
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
        // the order of INDEXER_IDS is the priority unless INDEXER_PRIORITY overrides it.
        // Both empty is a real answer and not a missing one: nobody named an order, so no
        // indexer outranks another and the seeder count decides — which is exactly what
        // happened before too, when an unnamed list meant one aggregate id
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

/**
 * The letters with no decomposition of their own, spelled out because `NFD` cannot help
 * with them: `ø` is one character and always was, and so are `đ`, `ł` and `ß`. A Danish
 * or a Polish title has exactly the Hungarian problem below, and a letter silently
 * deleted is the whole failure this is here to stop.
 */
const FOLDED: Record<string, string> = {
    "ø": "o", "đ": "d", "ð": "d", "ł": "l", "ß": "ss", "æ": "ae", "œ": "oe", "þ": "th", "ħ": "h", "ı": "i"
};

/**
 * Two names are the same name when nothing but punctuation and accents separates them.
 *
 * The accents are the part that was missing, and it was not a near miss: `[^a-z0-9]`
 * removes an accented letter *whole*, because `ü` is not in `a-z`. So "A nemzet hülyéje"
 * normalised to `anemzethlyje` — a word no release has ever been named — while every
 * release of it on nCore is `A.nemzet.hulyeje.S01E02...`, which normalises to
 * `anemzethulyeje`. The two could never be equal, so `matchesTarget` refused all seven
 * releases of the show with "title mismatch" and the scanner reported that it had found
 * nothing (reported 2026-11-24). Every accented title was in the same position: the more
 * Hungarian the name, the more certainly it could not be downloaded.
 *
 * `NFD` splits `ü` into `u` and a combining mark, and the mark is in a range the sweep
 * below was already removing — so the decomposition is what makes the sweep drop the
 * accent instead of the letter.
 *
 * One thing shifts underfoot: the blocklist is keyed by this function's output, so a
 * release blocked under the old spelling of an accented name is no longer recognised by
 * the new one. It gets one more chance and is blocked again under the new key, which is
 * the cheapest possible migration for a table that heals itself.
 */
export const normalizeTitle = (title: string) => {
    return title
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[øđðłßæœþħı]/g, (letter) => FOLDED[letter] || letter)
        .replace(/[^a-z0-9]+/g, "");
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

export type ReleaseSubject = { name: string, year: string | null };

/**
 * The season marker and **everything after it**, rather than only a trailing one.
 *
 * `releaseTitleOf` above cuts a marker that ends the title and nothing more, because that
 * is all `matchesTarget` needs — and cutting further there would loosen the one check a
 * faked release name cannot get past. Reading a name on its own is the opposite problem:
 * past the season marker there is only release noise, and whatever the noise happens to be
 * decides whether the title comes out usable.
 *
 * `Malcolm.in.the.Middle.S01-S07.COMPLETE.READ.NFO.576p…` is what made this necessary
 * (reported 2026-08-17): the `READ.NFO` sits between the marker and the end, so the
 * trailing rule does not fire, PTT reports the title as "Malcolm in the Middle S01-S07
 * COMPLETE READ NFO", and no catalogue has ever heard of that. The whole complete series
 * was on an indexer and could not be downloaded, because nothing could say what it was of.
 */
const SEASON_ONWARDS = new RegExp(`[\\s._-]+(?:${ SEASON_MARKER })(?![a-z0-9]).*$`, "i");

/**
 * What a release name claims to be about, in the two things a catalogue can be searched
 * with: the title, and the year if the name carries one.
 *
 * Only the manual search asks this, and it is deliberately more aggressive than the
 * matching above: there is no title here to be careful about, only a name to be placed.
 * The cut is dropped rather than trusted when it leaves nothing at all — a name that is
 * *only* a season marker is better asked in full than not asked.
 */
export const releaseSubject = (title: string): ReleaseSubject => {
    const parsed = PTT.parse(title) as { title?: string, year?: number };
    const full = releaseTitleOf(title, parsed);
    const cut = full.replace(SEASON_ONWARDS, "");

    return {
        name: (cut || full).replace(/[._]+/g, " ").replace(/\s+/g, " ").trim(),
        year: parsed.year ? String(parsed.year) : null
    };
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

/**
 * What a release turns out to be, worked out once and handed to every check below.
 *
 * Each of these costs a `PTT.parse` of the name, and the checks ask for the same three
 * answers between them — so they are read here rather than per question, which is also
 * what the single pass through the list used to do by hand.
 */
export type ReleaseFacts = {
    resolution: string | null;
    language: LanguageRating;
    // what the name counts as, untagged releases included — see `effectiveLanguages`
    languages: string[];
};

export const releaseFacts = (release: IndexerResult, profile: QualityProfile, target?: ReleaseTarget): ReleaseFacts => ({
    resolution: parseResolution(release.title),
    language: rateLanguage(release.title, profile, target),
    languages: effectiveLanguages(release.title, profile)
});

/**
 * What one question put to a release came back with. `detail` is what the check *saw*
 * whichever way it went — the seeder count, the resolution, the name it read — and
 * `rejection` is the sentence for the log, null when the release got past it.
 */
export type CheckOutcome = { detail: string, rejection: string | null };

const passed = (detail: string): CheckOutcome => ({ detail, rejection: null });
const refused = (reason: string): CheckOutcome => ({ detail: reason, rejection: reason });

/**
 * Every check a release is put through, in the order it is put through them.
 *
 * **Why this is a list and not a run of `if`s.** The scanner only ever wants the first
 * refusal: it is throwing the release away, and the remaining questions are moot. Somebody
 * asking *why nothing was found* wants the opposite — every question and every answer,
 * the passes included, because "it is the right show, in the right language, and the size
 * floor took it" is a different problem from "this was never that show at all", and the
 * first refusal alone cannot tell them apart.
 *
 * Two readers, one list. `rateRelease` walks it and stops at the first `rejection`;
 * `traceRelease` walks all of it and writes down what each one said. Nothing can drift
 * between the two, and a check added here is a check the diagnosis can already explain —
 * which matters, because a filter nobody can be told about is a filter nobody can fix.
 *
 * `step` is what the check is called and `code` is what it refuses *with*: the two
 * language rules are one refusal to a reader ("not in a language you want") and two
 * entirely different questions to anybody debugging one.
 */
export type ReleaseCheck = {
    step: CheckStep;
    code: RejectionCode;
    run: (release: IndexerResult, profile: QualityProfile, facts: ReleaseFacts, target?: ReleaseTarget) => CheckOutcome;
};

export const RELEASE_CHECKS: ReleaseCheck[] = [
    {
        step: "link",
        code: "no-link",
        run: (release) => release.link ? passed("has a download link") : refused("no download link")
    },
    {
        // it was grabbed once already and had to be thrown away: it either stood still
        // until it was given up on, or what came down was not the release at all
        step: "blocked",
        code: "blocked",
        run: (release) => isReleaseBlocked(normalizeTitle(release.title))
            ? refused("already tried and dropped")
            : passed("not on the blocklist")
    },
    {
        step: "seeders",
        code: "seeders",
        run: (release, profile) => release.seeders < profile.minSeeders
            ? refused(`${ release.seeders } seeders`)
            : passed(`${ release.seeders } seeders, at least ${ profile.minSeeders } wanted`)
    },
    {
        step: "maxSize",
        code: "too-big",
        run: (release, profile) => {
            if (profile.maxSizeGb <= 0) {
                return passed("no size ceiling");
            }

            return release.size > profile.maxSizeGb * GB
                ? refused(`${ (release.size / GB).toFixed(1) }GB is over the limit`)
                : passed(`${ (release.size / GB).toFixed(1) }GB, ceiling ${ profile.maxSizeGb }GB`);
        }
    },
    {
        step: "keywords",
        code: "excluded",
        run: (release, profile) => {
            const excluded = profile.excludeKeywords.find(keyword => hasKeyword(release.title, keyword));

            return excluded ? refused(`excluded keyword: ${ excluded }`) : passed("no excluded keyword in the name");
        }
    },
    {
        step: "title",
        code: "mismatch",
        run: (release, profile, facts, target) => {
            if (! target) {
                return passed("no title to match against");
            }

            const mismatch = matchesTarget(release.title, target);

            return mismatch
                ? refused(mismatch)
                : passed(`reads as ${ target.titles.join(" / ") || "the requested title" }`);
        }
    },
    {
        step: "languageExcluded",
        code: "language",
        run: (release, profile, facts) => facts.language.excluded
            ? refused(`language ${ facts.language.excluded } not wanted`)
            : passed(`${ facts.languages.join("/") }, none of them excluded`)
    },
    {
        // the unattended path: the wrong language is not a worse release here, it is a
        // different film to this person, and taking it would end their search for the one
        // they actually asked for
        step: "languageRequired",
        code: "language",
        run: (release, profile, facts) => {
            if (profile.requireLanguages.length === 0) {
                return passed("no language is required of it");
            }

            return facts.languages.some(language => profile.requireLanguages.includes(language))
                ? passed(`${ facts.languages.join("/") }, ${ profile.requireLanguages.join(" or ") } wanted`)
                : refused(`not in ${ profile.requireLanguages.join(" or ") }`);
        }
    },
    {
        // an unwanted resolution is dropped, an unknown one stays as a last resort
        step: "resolution",
        code: "resolution",
        run: (release, profile, facts) => {
            if (! facts.resolution) {
                return passed("no resolution in the name, kept as a last resort");
            }

            return profile.resolutions.includes(facts.resolution)
                ? passed(`${ facts.resolution }, wanted`)
                : refused(`resolution ${ facts.resolution } not wanted`);
        }
    },
    {
        step: "minSize",
        code: "too-small",
        run: (release, profile, facts, target) => {
            const floor = minSizeGb(facts.resolution, profile, target);

            if (floor <= 0) {
                return passed("no size floor");
            }

            return release.size < floor * GB
                ? refused(`${ (release.size / GB).toFixed(2) }GB is too small for ${ facts.resolution || "unknown resolution" } (min ${ floor }GB)`)
                : passed(`${ (release.size / GB).toFixed(2) }GB, floor ${ floor }GB`);
        }
    }
];

export const rateRelease = (release: IndexerResult, profile: QualityProfile, target?: ReleaseTarget): ScoredRelease | RejectedRelease => {
    const facts = releaseFacts(release, profile, target);

    for (const check of RELEASE_CHECKS) {
        const { rejection } = check.run(release, profile, facts, target);

        if (rejection) {
            return { release, code: check.code, reason: rejection };
        }
    }

    return { release, resolution: facts.resolution, score: score(release, facts.resolution, profile, facts.language.rank) };
};

/**
 * The same walk, written down instead of stopped at — see `RELEASE_CHECKS`. Every check
 * runs whatever the ones before it said, because a release with three things wrong with it
 * is worth knowing about as three things: fixing the first would only uncover the second.
 */
export const traceRelease = (release: IndexerResult, profile: QualityProfile, target?: ReleaseTarget): ReleaseTrace => {
    const facts = releaseFacts(release, profile, target);

    const steps = RELEASE_CHECKS.map(check => {
        const { detail, rejection } = check.run(release, profile, facts, target);

        return { step: check.step, code: check.code, ok: ! rejection, detail };
    });

    const accepted = steps.every(step => step.ok);

    return {
        title: release.title,
        indexer: release.indexerId,
        seeders: release.seeders,
        size: release.size,
        resolution: facts.resolution,
        languages: facts.languages,
        steps,
        score: accepted ? score(release, facts.resolution, profile, facts.language.rank) : null
    };
};

export const isScored = (value: ScoredRelease | RejectedRelease): value is ScoredRelease => {
    return (value as ScoredRelease).score !== undefined;
};

/**
 * The same profile with every size rule taken out of it: no ceiling, no floor, and so no
 * pack allowance to work out either. What is left is what a release *is* — its resolution,
 * its language, the keywords in its name, whether it was tried once and dropped.
 *
 * Only the manual search judges with this, and it is the difference between the two kinds
 * of rule in a quality profile. A resolution nobody wants is a statement about the file. A
 * size limit is a statement about the **install**: how much disk something may take when
 * nobody is watching, and how small a file may be before it is probably not the film. There
 * is nothing unattended about somebody typing a name and reading a list, and the 40GB remux
 * or the 400MB copy they went looking for on purpose was exactly what they could not have.
 */
export const withoutSizeLimits = (profile: QualityProfile): QualityProfile => ({
    ...profile,
    maxSizeGb: 0,
    maxPackSizeGb: 0,
    minSizeMovie: {},
    minSizeEpisode: {}
});

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

/**
 * The profile a whole season is judged by: both limits are per episode, so a pack is
 * allowed to be that much bigger. The pack ceiling is on by default — without one a
 * single "grab the whole season" decision can pull in a 200GB remux.
 *
 * Its own function because the diagnosis has to judge a pack by exactly what the scanner
 * judged it by, and a second copy of this arithmetic would be a second answer.
 */
export const packProfile = (profile: QualityProfile, episodeCount: number): QualityProfile => {
    const episodes = Math.max(episodeCount, 1);
    const caps = [ profile.maxSizeGb, profile.maxPackSizeGb ].filter(v => v > 0).map(v => v * episodes);

    return { ...profile, maxSizeGb: caps.length > 0 ? Math.min(...caps) : 0 };
};

export const selectSeasonRelease = (
    releases: IndexerResult[],
    season: number,
    episodeCount: number,
    profile: QualityProfile,
    titles: string[] = [],
    originalLanguage?: string | null
): ReleaseSelection => {
    return selectRelease(filterSeasonReleases(releases, season), packProfile(profile, episodeCount), {
        titles,
        kind: "pack",
        episodeCount,
        originalLanguage
    });
};
