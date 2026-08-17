import { RejectionCode } from "@/types/download";

/**
 * What a release turned out to be about, and it is a guess — read out of the release name
 * and looked up in TMDB, because that is all a free text search has to go on. It is on the
 * row rather than only in the answer to the download: a download has to be filed under a
 * title, and the person pressing the button is the one who can see whether it is the right
 * one.
 *
 * `episodeKeys` is what the name says this release carries of that title, as
 * `season:episode` — empty for a film, and empty as well for a show whose release name
 * carries no numbering at all. The reader's own wording is put on it by `coversText`, the
 * same one the library page uses.
 */
export type ReleaseMatch = {
    tmdbId: number;
    type: "movie" | "tv";
    name: string;
    year: string;
    // may be empty: TMDB has titles with no artwork at all
    poster: string;
    episodeKeys: string[];
    // this person already has this edition of exactly what the release carries. Not a
    // refusal — a second copy is sometimes the point — but it has to be said before the
    // disk fills up with the same film twice
    held: boolean;
};

/**
 * One release from a manual search. Everything a person needs to choose with is on it, and
 * `guid` is which row it is inside the search that is kept server side: a download hands
 * back a row and the server looks up what to fetch, so nothing the browser sends is ever
 * something the server goes and downloads. The release dialog identifies its options the
 * same way.
 *
 * `rejection` is why the quality profile would have thrown this one away, and null on
 * everything it accepted. The filter button on the page hides and shows exactly this:
 * the rows are all here either way, so turning it off is instant rather than another
 * search.
 */
export type ReleaseHit = {
    guid: string;
    title: string;
    size: number;
    seeders: number;
    peers: number;
    resolution: string | null;
    codec: string | null;
    // what the release name says it is in. An untagged one is shown as whatever the
    // install says untagged means, because that is how it will be treated
    languages: string[];
    indexer: string;
    // as the indexer reported it; empty when it reported nothing
    published: string;
    rejection: RejectionCode | null;
    match: ReleaseMatch | null;
};

export type ReleaseSearch = {
    searchId: string;
    query: string;
    hits: ReleaseHit[];
    // everything the indexers answered with, before anything was dropped or cut off —
    // so a capped list can say what it is not showing
    total: number;
    // how many of those the quality profile refused, which is the number the release
    // dialog speaks of when it found nothing
    filtered: number;
};
