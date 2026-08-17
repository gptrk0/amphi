import { ContentType } from "../../prisma/generated/client";
import { refreshBlocklist } from "@/lib/blocklist";
import { audience, executeGrab, GrabContext, StartedDownload } from "@/lib/grab";
import { findReleasesByName, IndexerResult } from "@/lib/indexer";
import { episodeKey, GrabbedEpisode, hasLibraryItem, heldEpisodes } from "@/lib/library";
import { findMediaByName, getMediaMetadata, getTvSeasons, RECORD_LANGUAGE } from "@/lib/media";
import {
    effectiveLanguages,
    isScored,
    parseCodec,
    parseNumbering,
    parseResolution,
    rateRelease,
    QualityProfile,
    ReleaseNumbering,
    releaseSubject,
    withoutSizeLimits
} from "@/lib/release";
import { settingNumber } from "@/lib/settings";
import { RejectionCode } from "@/types/download";
import { Media, MediaSeason } from "@/types/media";
import { ReleaseHit, ReleaseMatch, ReleaseSearch } from "@/types/release-search";

/**
 * Searching the indexers by name, for the times the app's own judgement is in the way.
 *
 * Everywhere else a search is about a title the app knows: it has an imdb id, it knows
 * which season it is missing, and the quality profile decides what may be taken. That is
 * the right behaviour for something running unattended, and it is the wrong behaviour when
 * a person is standing in front of it saying "I know it is there, show me". So this path
 * gives up all three:
 *
 * - **the query is words**, not an id — whatever was typed, handed to every indexer;
 * - **nothing is matched against a title**, because there is no title to match against.
 *   What the release name says it is about is worked out afterwards, from the name;
 * - **the profile only labels**, it does not remove. Every row comes back either way with
 *   the reason it would have been refused on it, and the filter on the page is a button;
 * - **and the size limits do not apply at all** — see `withoutSizeLimits`. They are the one
 *   part of the profile that is about the install rather than about the file, and they have
 *   no business refusing something a person deliberately went looking for. So `too-big` and
 *   `too-small` are not among the reasons a row on this page can carry, whichever way the
 *   filter button is set.
 *
 * What it cannot give up is a title to file the download under: the library is keyed by
 * TMDB id, and a download nothing points at is a torrent nobody will ever delete. So each
 * release is looked up in TMDB by the name in it — which is also where the poster on the
 * row comes from — and the one it resolves to is shown on the row *before* anything is
 * downloaded. A release that resolves to nothing is still listed, and only that one cannot
 * be started.
 */

const MAX_HITS = 100;

type StoredHit = {
    release: IndexerResult;
    // null when TMDB had nothing for the name in it: shown, and not downloadable
    match: ReleaseMatch | null;
    type: ContentType;
    episodes: GrabbedEpisode[];
};

type StoredSearch = {
    id: string;
    query: string;
    createdAt: number;
    // whose search it was, which decides where a download lands and in whose name — the
    // same reason the release dialog keeps it on the plan
    context: GrabContext;
    hits: Map<string, StoredHit>;
};

// A search costs tens of seconds and the download link never travels to the browser, so
// the answer is kept exactly as the download dialog keeps its plan — under the same
// setting, because the two are the same promise about the same kind of result.
const ttlMs = () => settingNumber("DOWNLOAD_PLAN_TTL_MINUTES") * 60 * 1000;
const MAX_SEARCHES = 20;

const globalForSearches = global as unknown as { releaseSearches: Map<string, StoredSearch> };
const searches = globalForSearches.releaseSearches || new Map<string, StoredSearch>();
globalForSearches.releaseSearches = searches;

const remember = (search: StoredSearch) => {
    for (const [ id, stored ] of searches) {
        if (stored.createdAt + ttlMs() < Date.now()) {
            searches.delete(id);
        }
    }

    while (searches.size >= MAX_SEARCHES) {
        searches.delete(searches.keys().next().value as string);
    }

    searches.set(search.id, search);
};

export const getStoredSearch = (id: string) => {
    const search = searches.get(id);

    if (! search) {
        return null;
    }

    return search.createdAt + ttlMs() < Date.now() ? null : search;
};

/** A title somebody arrived from, used only where the release name says nothing. */
export type SearchHint = { type: Media["type"], tmdbId: number };

const guidOf = (release: IndexerResult) => release.guid || release.link;

/**
 * What the release carries of the title it resolved to.
 *
 * A name with episode numbers in it carries exactly those. Anything else that names a
 * season is a pack, and a pack carries every episode TMDB has of the seasons in its name
 * — minus whatever has not aired, because a file cannot hold an episode that does not
 * exist yet.
 *
 * A show whose release name says nothing about seasons at all comes back empty, and that
 * is honest rather than convenient: the download is still filed under the show, but it
 * claims no episode, so nothing stops being searched for on the strength of it.
 */
const coveredEpisodes = async (
    tmdbId: number,
    numbering: ReleaseNumbering,
    seasonsOf: (tmdbId: number) => Promise<MediaSeason[]>
): Promise<GrabbedEpisode[]> => {
    if (numbering.episodes.length > 0 && numbering.seasons.length === 1) {
        return numbering.episodes.map(episodeNumber => ({ seasonNumber: numbering.seasons[0], episodeNumber }));
    }

    const seasons = await seasonsOf(tmdbId);
    const now = Date.now();

    return seasons
        .filter(season => numbering.seasons.includes(season.season_number))
        .flatMap(season => season.episodes
            .filter(episode => !! episode.air_date && new Date(episode.air_date).getTime() <= now)
            .map(episode => ({ seasonNumber: season.season_number, episodeNumber: episode.episode_number })));
};

/**
 * The profile's verdict on one release — with the size rules already out of the profile it
 * is handed, and with no target at all.
 *
 * No target because there is nothing left for one to say here. Its `titles` would be empty
 * (a free text search has nothing to match against, and refusing a release for "not looking
 * like this title" when nobody named a title is the app inventing an opinion), and its only
 * other job was to say which size table applies — and there are none any more.
 */
const verdict = (release: IndexerResult, profile: QualityProfile) => {
    const rated = rateRelease(release, profile);

    return isScored(rated)
        ? { score: rated.score, rejection: null as RejectionCode | null }
        : { score: 0, rejection: rated.code };
};

const toHit = (stored: StoredHit, rejection: RejectionCode | null, profile: QualityProfile): ReleaseHit => ({
    guid: guidOf(stored.release),
    title: stored.release.title,
    size: stored.release.size,
    seeders: stored.release.seeders,
    peers: stored.release.peers,
    resolution: parseResolution(stored.release.title),
    codec: parseCodec(stored.release.title),
    // the release name is the only place this exists, and it is the difference between
    // the film somebody wanted and the same film they cannot watch
    languages: effectiveLanguages(stored.release.title, profile),
    indexer: stored.release.indexerId,
    published: stored.release.pubDate,
    rejection,
    match: stored.match
});

/**
 * Everything the indexers have for those words, in the order a person wants to read it:
 * what the profile would take first, best first, and then what it refused, most seeded
 * first — because past the profile's own list the seeder count is what says whether a
 * release is worth anything.
 *
 * Both halves are always in the answer. The page hides the second one behind its filter
 * button, so turning the filter off is a click rather than another minute of searching.
 */
export const searchReleases = async (
    query: string,
    context: GrabContext,
    hint: SearchHint | null = null
): Promise<ReleaseSearch> => {
    // rating reads the blocklist synchronously, so it has to be in memory by then
    await refreshBlocklist();

    const releases = await findReleasesByName({ query });

    // one lookup per distinct name, not per release: a search for one film comes back as
    // thirty releases of it, and every one of them would otherwise be its own TMDB call.
    // The maps hold the promise rather than the answer, so the requests do not race either
    const titles = new Map<string, Promise<Media | null>>();
    const seasons = new Map<number, Promise<MediaSeason[]>>();
    const held = new Map<number, Promise<Set<string>>>();
    const heldMovies = new Map<number, Promise<boolean>>();

    const once = <K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>) => {
        const running = cache.get(key) || load();

        cache.set(key, running);

        return running;
    };

    // the title somebody came from, for the releases whose own name resolves to nothing.
    // Only ever a fallback: a name that TMDB knows is always believed over the page the
    // search was started from, or editing the query would go on filing downloads under
    // the title that page happened to be about
    const fallback = hint ? await getMediaMetadata(hint.type, hint.tmdbId) : null;

    const resolve = async (release: IndexerResult): Promise<StoredHit> => {
        const subject = releaseSubject(release.title);
        const numbering = parseNumbering(release.title);
        const isTv = numbering.seasons.length > 0;
        const type = isTv ? "tv" : "movie";

        const found = subject.name
            // a year on a show's release name is as often the episode's as the show's, so
            // it is only used to tell two films of the same name apart
            ? await once(titles, `${ type }:${ subject.name.toLowerCase() }:${ subject.year || "" }`,
                () => findMediaByName(subject.name, type, isTv ? null : subject.year))
            : null;

        const media = found || (fallback?.media.type === type ? fallback.media : null);

        if (! media) {
            return { release, match: null, type: isTv ? ContentType.TV : ContentType.MOVIE, episodes: [] };
        }

        const episodes = isTv
            ? await coveredEpisodes(media.id, numbering, (tmdbId) => once(seasons, tmdbId, () => getTvSeasons(tmdbId, RECORD_LANGUAGE)))
            : [];

        const owned = isTv
            ? episodes.length > 0 && await once(held, media.id, () => heldEpisodes(media.id, audience(context)))
                .then(keys => episodes.every(episode => keys.has(episodeKey(episode))))
            : await once(heldMovies, media.id, () => hasLibraryItem(media.id, audience(context)));

        return {
            release,
            type: isTv ? ContentType.TV : ContentType.MOVIE,
            episodes,
            match: {
                tmdbId: media.id,
                type,
                name: media.name,
                year: media.date ? media.date.split("-")[0] : "",
                poster: media.poster_img,
                episodeKeys: episodes.map(episodeKey),
                held: owned
            }
        };
    };

    const resolved = await Promise.all(releases.map(resolve));

    // the reader's own profile, minus the two rules that are the install's rather than the
    // file's. Everything else it says still holds, and still only as a label
    const judging = withoutSizeLimits(context.profile);

    const judged = resolved.map(stored => ({
        stored,
        ...verdict(stored.release, judging)
    }));

    const accepted = judged
        .filter(entry => ! entry.rejection)
        .sort((a, b) => b.score - a.score);

    const refused = judged
        .filter(entry => !! entry.rejection)
        // a release with no link is not a choice somebody could make, it is a dead end
        // dressed as one. It still counts as filtered, because the profile did drop it
        .filter(entry => entry.rejection !== "no-link")
        .sort((a, b) => b.stored.release.seeders - a.stored.release.seeders);

    const shown = [ ...accepted, ...refused ].slice(0, MAX_HITS);

    const search: StoredSearch = {
        id: crypto.randomUUID(),
        query,
        createdAt: Date.now(),
        context,
        hits: new Map(shown.map(entry => [ guidOf(entry.stored.release), entry.stored ]))
    };

    remember(search);

    return {
        searchId: search.id,
        query,
        hits: shown.map(entry => toHit(entry.stored, entry.rejection, context.profile)),
        total: releases.length,
        filtered: judged.filter(entry => !! entry.rejection).length
    };
};

/**
 * A release somebody picked off the list, started. The plan the scanner would have made
 * is not made at all: the release is the decision, the episodes are whatever its name
 * says it carries, and nothing about the quality profile is consulted a second time —
 * they were looking at the reason it was refused when they pressed the button.
 */
export const grabFromSearch = async (
    search: StoredSearch,
    guid: string,
    requestedBy: number
): Promise<{ hit: StoredHit, started: StartedDownload | null } | null> => {
    const hit = search.hits.get(guid);

    if (! hit) {
        return null;
    }

    if (! hit.match) {
        return { hit, started: null };
    }

    const started = await executeGrab(
        hit.match.tmdbId,
        hit.type,
        hit.release,
        hit.episodes,
        search.context,
        requestedBy
    );

    return { hit, started };
};
