import { ContentType, WatchStatus } from "../../prisma/generated/client";
import { refreshBlocklist } from "@/lib/blocklist";
import { grabContext } from "@/lib/grab";
import { findEpisodeReleases, findMovieReleases, findSeasonReleases, IndexerResult } from "@/lib/indexer";
import { languageProfileOf, searchLanguages } from "@/lib/language";
import { getImdbId, getMediaMetadata, getTvSeasons, mediaTitles, RECORD_LANGUAGE } from "@/lib/media";
import {
    normalizeTitle,
    packProfile,
    parseNumbering,
    QualityProfile,
    ReleaseTarget,
    traceRelease
} from "@/lib/release";
import { getWatchlistItem, toMediaType } from "@/lib/watchlist";
import { DiagnosisLine, ReleaseTrace, TraceStep, WatchlistDiagnosis } from "@/types/diagnosis";

/**
 * The scanner's own search, run again with the reasoning left in.
 *
 * Nothing here decides anything or writes anything down: it asks the same indexers the
 * same questions the scanner asks, with the same profile and the same target, and reports
 * what each release was put through. That is the whole contract — if this and the scanner
 * ever disagree, this one is wrong, which is why every judgement below comes out of
 * `release.ts` rather than being restated here.
 *
 * **What it deliberately does not do: all of it.** A season of twenty two episodes is
 * twenty two searches across every configured indexer, and a diagnosis that hammers an
 * account harder than a scan round is not a diagnostic tool. So it takes the first few
 * episodes still being looked for and says how many it left alone — the failure being
 * diagnosed is almost never specific to one episode anyway.
 */

// how many episode lines one run is allowed to search for, on top of the season pack
const EPISODE_LINES = 3;

// and how many releases of one line are worth writing down. Sorted best first, so the cut
// is off the tail — a hundred traces is not a page anybody reads
const TRACE_LIMIT = 30;

/**
 * Whether the name says this is the line at all, which is the one check that happens
 * *before* the quality profile ever sees the release — `filterEpisodeReleases` and
 * `filterSeasonReleases` do it by dropping the release from the pool entirely.
 *
 * It has to be in the trace for the same reason it is in those filters: a search for
 * S01E02 that comes back full of S01E01 has found nothing, and "nothing found" with an
 * empty list underneath it looks like an indexer that answered nothing at all.
 */
const numberingStep = (release: IndexerResult, line: { season: number | null, episode: number | null }): TraceStep => {
    if (line.season === null) {
        return { step: "numbering", code: "mismatch", ok: true, detail: "a film, so there is nothing to number" };
    }

    const numbering = parseNumbering(release.title);

    const read = [
        numbering.seasons.length > 0 ? `S${ numbering.seasons.map(v => String(v).padStart(2, "0")).join("+S") }` : "",
        numbering.episodes.length > 0 ? `E${ numbering.episodes.map(v => String(v).padStart(2, "0")).join(",E") }` : ""
    ].filter(Boolean).join("") || "no season or episode in the name";

    // a pack is the season and *no* episode numbers: a name that carries one is a single
    // episode, however complete the rest of the name claims to be
    const ok = line.episode === null
        ? numbering.episodes.length === 0 && numbering.seasons.includes(line.season)
        : numbering.seasons.includes(line.season) && numbering.episodes.includes(line.episode);

    return { step: "numbering", code: "mismatch", ok, detail: `reads as ${ read }` };
};

/**
 * One line of the diagnosis: everything that came back for one search, each release with
 * the numbering question in front of the profile's own.
 */
const traceLine = (
    key: string,
    label: string,
    query: string,
    releases: IndexerResult[],
    profile: QualityProfile,
    target: ReleaseTarget,
    line: { season: number | null, episode: number | null }
): DiagnosisLine => {
    const traced: ReleaseTrace[] = releases.map(release => {
        const numbering = numberingStep(release, line);
        const trace = traceRelease(release, profile, target);

        return {
            ...trace,
            steps: [ numbering, ...trace.steps ],
            // the profile never saw it, so whatever it would have scored is not a fact
            // about this search
            score: numbering.ok ? trace.score : null
        };
    });

    const accepted = traced.filter(trace => trace.steps.every(step => step.ok));

    // what the scanner would have taken first, then everything else by the only measure a
    // refused release still has. The cut below is off the end of that
    const sorted = [ ...traced ].sort((a, b) => {
        const left = a.steps.every(step => step.ok) ? a.score ?? 0 : -1;
        const right = b.steps.every(step => step.ok) ? b.score ?? 0 : -1;

        return left !== right ? right - left : b.seeders - a.seeders;
    });

    return {
        key,
        label,
        query,
        found: releases.length,
        accepted: accepted.length,
        releases: sorted.slice(0, TRACE_LIMIT)
    };
};

const seasonTag = (season: number) => `S${ String(season).padStart(2, "0") }`;
const episodeTag = (season: number, episode: number) => `${ seasonTag(season) }E${ String(episode).padStart(2, "0") }`;

/**
 * `null` when the row is gone or TMDB cannot say what it is — the caller turns that into a
 * 404, because a diagnosis of nothing is not a diagnosis.
 */
export const diagnoseWatchlistRow = async (watchlistId: number): Promise<WatchlistDiagnosis | null> => {
    const item = await getWatchlistItem(watchlistId);

    if (! item) {
        return null;
    }

    // the blocked check reads this synchronously, exactly as it does inside a scan round
    await refreshBlocklist();

    const type = toMediaType(item.type);
    const metadata = await getMediaMetadata(type, item.tmdbId, RECORD_LANGUAGE);

    if (! metadata) {
        return null;
    }

    // the row's own language first, then the owner's account — `searchLanguages` again,
    // because being judged by somebody else's rules would diagnose somebody else's search
    const languages = searchLanguages(await languageProfileOf(item.userId), item.language);
    const context = await grabContext([ item.userId ], { strict: true, languages });

    const imdbId = await getImdbId(type, item.tmdbId);
    const titles = await mediaTitles(type, item.tmdbId);
    const profile = context.profile;

    const diagnosis: WatchlistDiagnosis = {
        id: item.id,
        tmdbId: item.tmdbId,
        type,
        name: metadata.media.name || metadata.original_name,
        titles: titles.map(name => ({ name, normalized: normalizeTitle(name) })),
        languages: profile.requireLanguages,
        imdbId,
        lines: [],
        skipped: 0
    };

    if (item.type === ContentType.MOVIE) {
        const query = [ metadata.original_name, metadata.year ].filter(Boolean).join(" ");
        const releases = await findMovieReleases({ imdbId, title: metadata.original_name, year: metadata.year });

        diagnosis.lines.push(traceLine(
            "movie",
            metadata.media.name || metadata.original_name,
            query,
            releases,
            profile,
            { titles, kind: "movie", year: metadata.year, originalLanguage: metadata.original_language },
            { season: null, episode: null }
        ));

        return diagnosis;
    }

    // exactly what `scanEpisodes` picks up: watched, out, and not yet found. An episode
    // held back by its air date is not a failed search and has nothing to explain
    const waiting = item.units.filter(unit =>
        unit.monitored
        && unit.seasonNumber !== null
        && unit.episodeNumber !== null
        && !! unit.airDate
        && unit.airDate.getTime() <= Date.now()
        && (unit.status === WatchStatus.PENDING || unit.status === WatchStatus.SEARCHING));

    if (waiting.length === 0) {
        return diagnosis;
    }

    // one season per run: the scanner groups by season too, and a pack search belongs to
    // exactly one of them
    const seasonNumber = Math.min(...waiting.map(unit => unit.seasonNumber as number));
    const inSeason = waiting
        .filter(unit => unit.seasonNumber === seasonNumber)
        .map(unit => unit.episodeNumber as number)
        .sort((a, b) => a - b);

    const seasons = await getTvSeasons(item.tmdbId, RECORD_LANGUAGE);
    const season = seasons.find(v => v.season_number === seasonNumber);
    const episodeCount = season?.episodes.length || inSeason.length;

    const seasonQuery = `${ metadata.original_name } ${ seasonTag(seasonNumber) }`;
    const seasonReleases = await findSeasonReleases({ imdbId, title: metadata.original_name, season: seasonNumber });

    diagnosis.lines.push(traceLine(
        `s${ seasonNumber }`,
        `${ seasonTag(seasonNumber) } pack`,
        seasonQuery,
        seasonReleases,
        packProfile(profile, episodeCount),
        { titles, kind: "pack", episodeCount, originalLanguage: metadata.original_language },
        { season: seasonNumber, episode: null }
    ));

    const searched = inSeason.slice(0, EPISODE_LINES);

    diagnosis.skipped = inSeason.length - searched.length;

    for (const episodeNumber of searched) {
        const own = await findEpisodeReleases({
            imdbId,
            title: metadata.original_name,
            season: seasonNumber,
            episode: episodeNumber
        });

        // the fallback the scanner uses as well: an episode search that comes back empty
        // is judged against whatever the season search found
        const pool = own.length > 0 ? own : seasonReleases;

        diagnosis.lines.push(traceLine(
            `s${ seasonNumber }e${ episodeNumber }`,
            episodeTag(seasonNumber, episodeNumber),
            own.length > 0
                ? `${ metadata.original_name } ${ episodeTag(seasonNumber, episodeNumber) }`
                : `${ seasonQuery } (the episode search found nothing, so the season's results were judged instead)`,
            pool,
            profile,
            { titles, kind: "episode", originalLanguage: metadata.original_language },
            { season: seasonNumber, episode: episodeNumber }
        ));
    }

    return diagnosis;
};
