export type MissingSeason = {
    seasonNumber: number;
    episodeNumbers: number[];
};

/**
 * Why the quality profile refused a release, as a key rather than a sentence: the
 * numbers behind it (the size, the seeder count, the resolution) are already on the
 * line, so the reader only needs the *kind* of refusal — and that way it can be said
 * in their own language. The server keeps its own English sentence for the log.
 *
 * `no-link` never reaches the dialog: a release with nothing to download is not a
 * choice, it is a dead end.
 */
export type RejectionCode =
    | "no-link"
    | "blocked"
    | "seeders"
    | "too-big"
    | "excluded"
    | "mismatch"
    | "language"
    | "resolution"
    | "too-small";

/**
 * One release the user can pick. The guid identifies it inside the stored plan, so
 * the download link itself never travels to the browser and back.
 */
export type GrabOption = {
    guid: string;
    title: string;
    size: number;
    seeders: number;
    resolution: string | null;
    // what the release name says it is in. An untagged one is shown as whatever the
    // account says untagged means, because that is how it will be treated
    languages: string[];
    indexer: string;
    // why the profile threw this one away. Null on everything it accepted — including
    // the runners up that simply did not fit in the list
    rejection: RejectionCode | null;
};

/**
 * One line of the download dialog: a movie, a season pack or a single episode,
 * with the releases found for it. The first option is what the quality profile
 * would have taken on its own.
 */
export type GrabChoice = {
    key: string;
    label: string;
    seasonNumber: number | null;
    episodeNumbers: number[];
    isPack: boolean;
    options: GrabOption[];
    /**
     * Everything else the search turned up for this line, hidden until asked for: first
     * the releases the profile accepted but had no room for, then the ones it refused,
     * each with its reason. Pickable, all of them — the dialog is the one place where a
     * person may knowingly take something the unattended scanner never would.
     *
     * Not everything, though: what has no download link and what is under the seeder
     * minimum stays out, because neither can actually be downloaded. So this list is
     * exactly what is on screen when the line is opened all the way, and a count of the
     * refusals in it can be taken from the list itself.
     */
    extras: GrabOption[];
};

export type DownloadPreview = {
    planId: string;
    type: "movie" | "tv";
    tmdbId: number;
    choices: GrabChoice[];
    missing: MissingSeason[];
    missingMovie: boolean;
    // every release the quality profile threw away, over the whole request
    filtered: number;
    /**
     * The languages a download would count as this person's, and the lines that have
     * nothing to offer in any of them. A non-empty `missing` is what turns the download
     * button into a question: the scanner would have gone on waiting, so starting anyway
     * is a choice somebody makes.
     *
     * More than one language when the account accepts every language on its list.
     */
    language: { wanted: string[], missing: string[] };
    /**
     * Lines this person already has in this edition. Episodes are gone from `choices`
     * — the grab would refuse them anyway — while a film is still offered, because a
     * second copy is something the grab will really do, and sometimes what is wanted.
     */
    held: string[];
};
