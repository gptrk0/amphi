import { RejectionCode } from "@/types/download";

/**
 * What the scanner actually did, for the one question the log cannot answer.
 *
 * "Nothing found" is a true sentence and a useless one: it is the same sentence whether
 * the indexers returned nothing, or returned the release and the quality profile refused
 * it, or returned it under a name the app could not recognise as this title. Those are
 * three different things to fix and the log spells none of them out — which is how seven
 * nCore releases of "A nemzet hülyéje" sat there for a day while the watchlist said it had
 * looked and found nothing (2026-11-24).
 *
 * So this is the search run again, in front of somebody, with every step written down:
 * what was asked of which indexer, what came back, and for each release every check it was
 * put through and what that check saw. Administrators only — it names the indexers, it
 * reads other people's watchlist rows, and running it hits every indexer at once.
 */

/**
 * One question put to a release. `numbering` is the odd one out: it is not part of the
 * quality profile at all but of the line itself — whether the name says it is this
 * episode — and it runs before any of the others, which is why a release can fail it and
 * never be seen by the rest.
 */
export type CheckStep =
    | "numbering"
    | "link"
    | "blocked"
    | "seeders"
    | "maxSize"
    | "keywords"
    | "title"
    | "languageExcluded"
    | "languageRequired"
    | "resolution"
    | "minSize";

export type TraceStep = {
    step: CheckStep;
    // what this one refuses with, which is how the dialog borrows the download dialog's
    // own wording for the refusals
    code: RejectionCode;
    ok: boolean;
    // what the check saw, in English and with the numbers in it: a record of a run, like
    // the log, rather than something that changes language under the reader
    detail: string;
};

export type ReleaseTrace = {
    title: string;
    indexer: string;
    seeders: number;
    size: number;
    resolution: string | null;
    languages: string[];
    steps: TraceStep[];
    // what it scored, null when something threw it away
    score: number | null;
};

/**
 * One thing that was searched for: a film, a season pack, or a single episode. The
 * scanner makes one search per line and judges every result of it, so the trace is
 * shaped the same way.
 */
export type DiagnosisLine = {
    key: string;
    // "S01E02", "Season 1 pack", "film" — already readable, built where the numbers are
    label: string;
    // what the indexers were asked, exactly as they were asked it
    query: string;
    // how many came back before anything judged them
    found: number;
    accepted: number;
    releases: ReleaseTrace[];
};

export type WatchlistDiagnosis = {
    id: number;
    tmdbId: number;
    type: "movie" | "tv";
    name: string;
    /**
     * Every name a release may call this title, and what each one is compared *as* — the
     * normalised form, which is the string the match actually runs on. It is on screen
     * because that is where an accent or a stray colon goes missing, and seeing
     * `anemzethulyeje` next to `anemzethlyje` is the entire diagnosis of a whole class of
     * failure.
     */
    titles: { name: string, normalized: string }[];
    // what the row insists on, which is what makes `languageRequired` refuse anything
    languages: string[];
    imdbId: string | null;
    lines: DiagnosisLine[];
    // lines that exist and were not searched, because a diagnosis must not hit every
    // indexer once per episode of a twenty two episode season
    skipped: number;
};
