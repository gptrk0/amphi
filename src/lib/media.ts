import {
    Media,
    MediaCompany,
    MediaDetails,
    MediaGenre,
    MediaMetadata,
    MediaPage,
    MediaPerson,
    MediaSeason,
    PersonCredit,
    PersonDetails
} from "@/types/media";
import axios from "axios";

import { DEFAULT_LOCALE, Locale, LOCALES } from "@/i18n";
import { errorText, logError, LogLevel, logThrottled } from "@/lib/log";
import { readerLocale } from "@/lib/locale";
import { loadSettings, settingNumber, settingText } from "@/lib/settings";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const apiKey = () => settingText("TMDB_API_KEY");

/** Nothing on the discover pages can work without this one, so it is worth asking. */
export const isTmdbConfigured = () => !! apiKey();

// one line a minute per kind of failure: a wrong key fails every row of the home page at
// once, and seven identical entries are not seven pieces of information
const FAILURE_WINDOW_MS = 60 * 1000;

/**
 * A missing api key means every row of the home page fails at once, and dumping seven
 * axios errors reads as a broken app rather than an unconfigured one.
 */
const logTmdbFailure = async (err: unknown) => {
    if (! axios.isAxiosError(err)) {
        await logError("tmdb", "a request failed", errorText(err));

        return;
    }

    const path = (err.config?.url || "").replace(TMDB_BASE_URL, "");
    const status = err.response?.status;

    if (status === 401) {
        await logThrottled(
            "tmdb:401",
            FAILURE_WINDOW_MS,
            LogLevel.WARN,
            "tmdb",
            "the api key is missing or wrong, so nothing can be listed or searched (Settings / TMDB)",
            path
        );

        return;
    }

    await logThrottled(
        `tmdb:${ status ?? err.code }`,
        FAILURE_WINDOW_MS,
        LogLevel.WARN,
        "tmdb",
        `a request failed: ${ status ?? err.code ?? "no answer" }`,
        `${ path } — ${ err.message }`
    );
};

/**
 * Which language TMDB answers in, and it is nobody's setting.
 *
 * It used to be two: a language and a region, install wide. Both are gone (2026-08-11).
 * The interface is already in the reader's language, and a Hungarian page carrying English
 * titles and English plot summaries is the interface only half translated — so the answer
 * follows the same cookie the shell does. That also makes the search box work the way the
 * page reads: ask TMDB in Hungarian and „A bárányok hallgatnak" finds the film.
 *
 * The region went with it because it was never an independent choice. It decides whose age
 * rating to show, and the honest answer for somebody reading in Hungarian is the Hungarian
 * board — which is what the language already says.
 */
const TMDB_LANGUAGES: Record<Locale, string> = { en: "en-US", hu: "hu-HU" };

/**
 * The language for anything no particular person is reading: a log line, a notification,
 * the titles a release name is matched against. Those are records and machinery, and both
 * would be worse for changing with whoever happened to be logged in.
 */
export const RECORD_LANGUAGE = TMDB_LANGUAGES[DEFAULT_LOCALE];

const readerLanguage = async () => TMDB_LANGUAGES[await readerLocale()];

// certifications and streaming services are per country, and the language already
// carries one — "en-US" means the US ratings board and US providers
const regionOf = (language: string) => (language.split("-")[1] || "US").toUpperCase();

const cacheTtlMs = () => settingNumber("TMDB_CACHE_TTL_MINUTES") * 60 * 1000;

type CacheEntry = { value: unknown, expiresAt: number };

// The watchlist stores ids only, so every listing and every scanner run reads TMDB.
// Kept on global so hot reload does not drop it.
const globalForTmdb = global as unknown as { tmdbCache: Map<string, CacheEntry> };
const tmdbCache = globalForTmdb.tmdbCache || new Map<string, CacheEntry>();
globalForTmdb.tmdbCache = tmdbCache;

// discover rows move faster than metadata, so they get their own, shorter ttl
const discoverTtlMs = () => settingNumber("DISCOVER_CACHE_TTL_MINUTES") * 60 * 1000;

const cached = async <T>(
    key: string,
    loader: () => Promise<T>,
    isEmpty: (value: T) => boolean,
    ttl: number = cacheTtlMs()
): Promise<T> => {
    // every TMDB read comes through here, which makes it the cheap place to be sure the
    // settings are in memory — the call is a no-op while its own cache is warm
    await loadSettings();

    const hit = tmdbCache.get(key);

    if (hit && hit.expiresAt > Date.now()) {
        return hit.value as T;
    }

    const value = await loader();

    // never cache a failed lookup, otherwise a TMDB outage sticks
    if (! isEmpty(value)) {
        tmdbCache.set(key, { value, expiresAt: Date.now() + ttl });
    }

    return value;
};

export const clearMediaCache = () => {
    tmdbCache.clear();
};

// search results often have no artwork at all, so an empty string means "no image"
const image = (path: string | null | undefined, size: string) => {
    return path ? `https://image.tmdb.org/t/p/${ size }${ path }` : "";
};

export const isMediaType = (type: unknown): type is Media["type"] => type === "movie" || type === "tv";

export const toMedia = (data: any, type: Media["type"]): Media => {
    return {
        id: data.id,
        type,
        name: (type === "movie" ? data.title : data.name) || "",
        overview: data.overview || "",
        date: (type === "movie" ? data.release_date : data.first_air_date) || "",
        poster_img: image(data.poster_path, "w500"),
        backdrop_img: image(data.backdrop_path, "original")
    };
};

export async function fetchMediaMetadata(type: string, id: number, language: string): Promise<MediaMetadata | null> {
    if (! isMediaType(type)) {
        return null;
    }

    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/${ type }/${ id }`, {
            params: {
                api_key: apiKey(),
                language
            }
        });

        const data = res.data;
        const media = toMedia(data, type);

        return {
            media,
            original_name: (type === "movie" ? data.original_title : data.original_name) || media.name,
            original_language: data.original_language || null,
            year: media.date ? media.date.split("-")[0] : null
        };

    } catch(err) {
        await logTmdbFailure(err);
    }

    return null;
}

/**
 * The language is in the cache key, because the same title in two languages is two
 * different answers — without it the first reader would decide what the second one sees.
 * The optional argument is for the callers that must not follow a reader: pass
 * `RECORD_LANGUAGE` there.
 */
export async function getMediaMetadata(type: string, id: number, language?: string): Promise<MediaMetadata | null> {
    const wanted = language || await readerLanguage();

    return await cached(
        `metadata:${ wanted }:${ type }:${ id }`,
        () => fetchMediaMetadata(type, id, wanted),
        (value) => value === null
    );
}

/**
 * Every name this title is known by that the app can see: the original, plus the localised
 * one in each language the interface has. What a release name is matched against, and the
 * reason it is all of them at once — an `ncore` release is named in Hungarian and a
 * scene release in English, and which of the two a person happens to be reading the page
 * in has nothing to do with which of them exists.
 */
export async function mediaTitles(type: string, id: number): Promise<string[]> {
    const found = await Promise.all(LOCALES.map(locale => getMediaMetadata(type, id, TMDB_LANGUAGES[locale])));
    const names = found.flatMap(metadata => metadata ? [ metadata.original_name, metadata.media.name ] : []);

    return [ ...new Set(names.filter(Boolean)) ];
}

/**
 * Multi search, people filtered out. Not cached: a title that has just been added
 * to TMDB should show up right away.
 */
export async function searchMedia(query: string, page: number): Promise<MediaPage> {
    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/search/multi`, {
            params: {
                api_key: apiKey(),
                language: await readerLanguage(),
                include_adult: false,
                query,
                page
            }
        });

        const results: Media[] = (res.data.results || [])
            .filter((v: any) => isMediaType(v.media_type))
            .map((v: any) => toMedia(v, v.media_type));

        return {
            results,
            page: res.data.page || page,
            totalPages: res.data.total_pages || 0
        };

    } catch(err) {
        await logTmdbFailure(err);
    }

    return { results: [], page, totalPages: 0 };
}

/**
 * The one title a name is most likely to mean, asked of the typed endpoints rather than
 * of multi search: a manual search already knows from the release name whether it is
 * looking at a film or at episodes, and `/search/multi` would happily answer a film with
 * the documentary series about it.
 *
 * The year is a filter and not a preference, so it is dropped and the search made again
 * when it comes back empty: the year on a release name is whatever the parser could read
 * out of it, and a wrong one must not be the reason a release cannot be downloaded.
 */
export async function fetchMediaByName(
    name: string,
    type: Media["type"],
    year: string | null,
    language: string
): Promise<Media | null> {
    const ask = async (withYear: boolean) => {
        const res = await axios.get(`${ TMDB_BASE_URL }/search/${ type }`, {
            params: {
                api_key: apiKey(),
                language,
                include_adult: false,
                query: name,
                ...(withYear && year ? (type === "movie" ? { year } : { first_air_date_year: year }) : {})
            }
        });

        return (res.data.results || [])[0] || null;
    };

    try {
        const found = await ask(true) || (year ? await ask(false) : null);

        return found ? toMedia(found, type) : null;

    } catch(err) {
        await logTmdbFailure(err);
    }

    return null;
}

/**
 * Cached like every other read here, and keyed on the reader's language because the name
 * and the poster that come back are what they will see. The search itself matches every
 * language TMDB knows the title in whatever this is set to — which is the reason an
 * `ncore` release named in Hungarian finds the same film an English scene release does.
 */
export async function findMediaByName(
    name: string,
    type: Media["type"],
    year: string | null = null
): Promise<Media | null> {
    const language = await readerLanguage();

    return await cached(
        `named:${ language }:${ type }:${ name.toLowerCase() }:${ year || "" }`,
        () => fetchMediaByName(name, type, year, language),
        (value) => value === null
    );
}

const CATEGORIES: Record<string, string[]> = {
    all: [ "trending" ],
    movie: [ "trending", "popular", "top_rated", "now_playing", "upcoming" ],
    tv: [ "trending", "popular", "top_rated", "airing_today", "on_the_air" ]
};

export const discoverCategories = (type: string): string[] => CATEGORIES[type] || CATEGORIES.all;

const discoverPath = (category: string, type: string): string | null => {
    if (category === "trending") {
        return `/trending/${ type }/day`;
    }

    return isMediaType(type) && discoverCategories(type).includes(category) ? `/${ type }/${ category }` : null;
};

export type DiscoverOptions = {
    type: string;
    category: string;
    page: number;
    genre?: string | null;
};

export async function fetchDiscoverPage(
    { type, category, page, genre }: DiscoverOptions,
    language: string
): Promise<MediaPage> {
    // a genre filter is a different endpoint, and tmdb genre ids differ per type
    const byGenre = !! genre && isMediaType(type);
    const path = byGenre ? `/discover/${ type }` : discoverPath(category, type);

    if (! path) {
        return { results: [], page, totalPages: 0 };
    }

    try {
        const res = await axios.get(`${ TMDB_BASE_URL }${ path }`, {
            params: {
                api_key: apiKey(),
                language,
                page,
                ...(byGenre ? { with_genres: genre, sort_by: "popularity.desc", include_adult: false } : {})
            }
        });

        // only the trending endpoints report a media_type per item
        const results: Media[] = (res.data.results || [])
            .map((v: any) => {
                if (isMediaType(v.media_type)) {
                    return toMedia(v, v.media_type);
                }

                return isMediaType(type) ? toMedia(v, type) : null;
            })
            .filter(Boolean);

        return { results, page: res.data.page || page, totalPages: res.data.total_pages || 0 };

    } catch(err) {
        await logTmdbFailure(err);
    }

    return { results: [], page, totalPages: 0 };
}

export async function getDiscoverPage(options: DiscoverOptions): Promise<MediaPage> {
    const language = await readerLanguage();

    return await cached(
        `discover:${ language }:${ options.type }:${ options.category }:${ options.genre || "" }:${ options.page }`,
        () => fetchDiscoverPage(options, language),
        (value) => value.results.length === 0,
        discoverTtlMs()
    );
}

export async function fetchGenres(type: string, language: string): Promise<MediaGenre[]> {
    if (! isMediaType(type)) {
        return [];
    }

    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/genre/${ type }/list`, {
            params: {
                api_key: apiKey(),
                language
            }
        });

        return (res.data.genres || []).map((v: any) => ({ id: v.id, name: v.name }));

    } catch(err) {
        await logTmdbFailure(err);
    }

    return [];
}

export async function getGenres(type: string): Promise<MediaGenre[]> {
    const language = await readerLanguage();

    return await cached(
        `genres:${ language }:${ type }`,
        () => fetchGenres(type, language),
        (value) => value.length === 0
    );
}

export async function fetchImdbId(type: string, id: number): Promise<string | null> {
    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/${ type }/${ id }/external_ids`, {
            params: { api_key: apiKey() }
        });

        return res.data?.imdb_id || null;

    } catch(err) {
        await logTmdbFailure(err);
    }

    return null;
}

export async function getImdbId(type: string, id: number): Promise<string | null> {
    return await cached(
        `imdb:${ type }:${ id }`,
        () => fetchImdbId(type, id),
        (value) => value === null
    );
}

const CAST_LIMIT = 20;
const CREW_JOBS = [ "Director", "Creator", "Screenplay", "Writer", "Story", "Novel", "Original Music Composer" ];
const ROW_LIMIT = 20;

const toCompany = (data: any): MediaCompany => {
    return {
        id: data.id,
        name: data.name || "",
        logo_img: image(data.logo_path, "w185")
    };
};

const toPerson = (data: any, role: string): MediaPerson => {
    return {
        id: data.id,
        name: data.name || "",
        role,
        profile_img: image(data.profile_path, "w185")
    };
};

/**
 * A show's cast is only meaningful over the whole run, which is what
 * aggregate_credits reports — a plain credits call on a long running series
 * returns whoever happened to be in the last season.
 */
const toCast = (credits: any): MediaPerson[] => {
    return (credits?.cast || [])
        .slice(0, CAST_LIMIT)
        .map((person: any) => toPerson(person, person.character || person.roles?.[0]?.character || ""));
};

/**
 * The people worth naming: whoever made it, not the whole crew list. A person can
 * hold several of these jobs, and then the jobs are joined instead of repeating them.
 */
const toCrew = (credits: any, createdBy: any[], isTv: boolean): MediaPerson[] => {
    const people = new Map<number, MediaPerson>();

    for (const person of createdBy || []) {
        people.set(person.id, toPerson(person, "Creator"));
    }

    // a show's aggregate crew is every episode's director and writer, which says
    // nothing about who made it — the creators do
    for (const person of isTv ? [] : credits?.crew || []) {
        const job = person.job || person.jobs?.[0]?.job || "";

        if (! CREW_JOBS.includes(job)) {
            continue;
        }

        const known = people.get(person.id);

        people.set(person.id, known
            ? { ...known, role: known.role.includes(job) ? known.role : `${ known.role }, ${ job }` }
            : toPerson(person, job));
    }

    return [ ...people.values() ].slice(0, 8);
};

const toTrailer = (videos: any) => {
    const results = (videos?.results || []).filter((video: any) => video.site === "YouTube");

    const best = results.find((video: any) => video.type === "Trailer" && video.official)
        || results.find((video: any) => video.type === "Trailer")
        || results.find((video: any) => video.type === "Teaser");

    return best ? { key: best.key, name: best.name || "Trailer" } : null;
};

/**
 * The age rating of the reader's own country, which is the one their language names. Films
 * carry it per release, shows have one per country.
 */
const toCertification = (data: any, type: Media["type"], region: string): string | null => {
    if (type === "tv") {
        const found = (data.content_ratings?.results || []).find((v: any) => v.iso_3166_1 === region);

        return found?.rating || null;
    }

    const found = (data.release_dates?.results || []).find((v: any) => v.iso_3166_1 === region);
    const rated = (found?.release_dates || []).find((v: any) => v.certification);

    return rated?.certification || null;
};

const toRow = (value: any, type: Media["type"]): Media[] => {
    return (value?.results || [])
        .filter((item: any) => item.poster_path)
        .slice(0, ROW_LIMIT)
        .map((item: any) => toMedia(item, isMediaType(item.media_type) ? item.media_type : type));
};

export async function fetchMediaDetails(type: string, id: number, language: string): Promise<MediaDetails | null> {
    if (! isMediaType(type)) {
        return null;
    }

    const isTv = type === "tv";

    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/${ type }/${ id }`, {
            params: {
                api_key: apiKey(),
                language,
                append_to_response: [
                    isTv ? "aggregate_credits" : "credits",
                    "videos",
                    "external_ids",
                    "recommendations",
                    "similar",
                    isTv ? "content_ratings" : "release_dates"
                ].join(","),
                // a localised page still wants the english trailer when there is no
                // local one, and untagged videos are usually the original
                include_video_language: `${ language.split("-")[0] },en,null`
            }
        });

        const data = res.data;
        const media = toMedia(data, type);
        const credits = isTv ? data.aggregate_credits : data.credits;

        return {
            media,
            original_name: (isTv ? data.original_name : data.original_title) || media.name,
            original_language: data.original_language || null,
            tagline: data.tagline || "",
            status: data.status || "",
            runtime: (isTv ? (data.episode_run_time || [])[0] : data.runtime) || null,
            genres: (data.genres || []).map((genre: any) => ({ id: genre.id, name: genre.name })),
            rating: Number(data.vote_average || 0),
            votes: Number(data.vote_count || 0),
            certification: toCertification(data, type, regionOf(language)),
            homepage: data.homepage || "",
            imdb_id: data.external_ids?.imdb_id || null,
            budget: Number(data.budget || 0),
            revenue: Number(data.revenue || 0),
            companies: (data.production_companies || []).map(toCompany),
            countries: (data.production_countries || []).map((v: any) => v.name).filter(Boolean),
            languages: (data.spoken_languages || []).map((v: any) => v.english_name || v.name).filter(Boolean),
            cast: toCast(credits),
            crew: toCrew(credits, data.created_by, isTv),
            trailer: toTrailer(data.videos),
            recommendations: toRow(data.recommendations, type),
            similar: toRow(data.similar, type),
            season_count: isTv ? Number(data.number_of_seasons || 0) : null,
            episode_count: isTv ? Number(data.number_of_episodes || 0) : null,
            networks: isTv ? (data.networks || []).map(toCompany) : [],
            first_air_date: isTv ? (data.first_air_date || null) : null,
            last_air_date: isTv ? (data.last_air_date || null) : null,
            in_production: isTv ? !! data.in_production : null,
            next_episode: isTv && data.next_episode_to_air ? {
                name: data.next_episode_to_air.name || "",
                air_date: data.next_episode_to_air.air_date || null,
                season_number: data.next_episode_to_air.season_number,
                episode_number: data.next_episode_to_air.episode_number
            } : null
        };

    } catch(err) {
        await logTmdbFailure(err);
    }

    return null;
}

export async function getMediaDetails(type: string, id: number): Promise<MediaDetails | null> {
    const language = await readerLanguage();

    return await cached(
        `details:${ language }:${ type }:${ id }`,
        () => fetchMediaDetails(type, id, language),
        (value) => value === null
    );
}

/**
 * Seasons and episodes of a show, with air dates. Season 0 (specials) is skipped.
 */
export async function fetchTvSeasons(id: number, language: string): Promise<MediaSeason[]> {
    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/tv/${ id }`, {
            params: {
                api_key: apiKey(),
                language
            }
        });

        const seasonNumbers: number[] = (res.data.seasons || [])
            .map((v: any) => v.season_number)
            .filter((v: number) => v > 0);

        // /tv/{id} only carries season headers, the episodes need one request per season
        const seasons = await Promise.all(seasonNumbers.map(async (seasonNumber) => {
            const seasonRes = await axios.get(`${ TMDB_BASE_URL }/tv/${ id }/season/${ seasonNumber }`, {
                params: {
                    api_key: apiKey(),
                    language
                }
            });

            const data = seasonRes.data;

            const season: MediaSeason = {
                season_number: data.season_number,
                name: data.name,
                air_date: data.air_date || null,
                episode_count: (data.episodes || []).length,
                episodes: (data.episodes || []).map((v: any) => {
                    return {
                        episode_number: v.episode_number,
                        name: v.name,
                        overview: v.overview,
                        air_date: v.air_date || null
                    };
                })
            };

            return season;
        }));

        return seasons.sort((a, b) => a.season_number - b.season_number);

    } catch(err) {
        await logTmdbFailure(err);
    }

    return [];
}

export async function getTvSeasons(id: number, language?: string): Promise<MediaSeason[]> {
    const wanted = language || await readerLanguage();

    return await cached(
        `seasons:${ wanted }:${ id }`,
        () => fetchTvSeasons(id, wanted),
        (value) => value.length === 0
    );
}

// a prolific career is hundreds of credits, and a page nobody scrolls to the end of is
// still a payload somebody pays for. Enough to be a filmography, bounded on purpose
const CREDIT_LIMIT = 100;
const KNOWN_FOR_LIMIT = 12;

/**
 * One person's credits, deduplicated by title.
 *
 * TMDB lists the same title once per role — a show a person appeared in as two characters,
 * or wrote and directed — and a filmography that repeats the same film three times reads
 * like a bug. So the roles are joined and the title is one line.
 */
const toCredits = (entries: any[], roleOf: (entry: any) => string): PersonCredit[] => {
    const byTitle = new Map<string, PersonCredit>();

    for (const entry of entries) {
        const type = isMediaType(entry.media_type) ? entry.media_type : null;

        // a credit with no type is a TMDB row this app has no page for
        if (! type || ! entry.id) {
            continue;
        }

        const media = toMedia(entry, type);

        if (! media.name) {
            continue;
        }

        const role = roleOf(entry);
        const key = `${ type }:${ entry.id }`;
        const known = byTitle.get(key);

        if (known) {
            if (role && ! known.role.split(", ").includes(role)) {
                byTitle.set(key, { ...known, role: known.role ? `${ known.role }, ${ role }` : role });
            }

            continue;
        }

        byTitle.set(key, { media, role, year: media.date ? media.date.split("-")[0] : "" });
    }

    // newest first, and whatever has no date at all goes last: an unreleased or undated
    // credit is not the thing to open a filmography with
    return [ ...byTitle.values() ]
        .sort((a, b) => {
            if (! a.year || ! b.year) {
                return a.year ? -1 : b.year ? 1 : 0;
            }

            return b.media.date.localeCompare(a.media.date);
        })
        .slice(0, CREDIT_LIMIT);
};

/**
 * What this person is known for. TMDB only answers that on search results, so it is
 * derived here the same way: the most popular titles they were in, whichever side of the
 * camera they were on. Posters only — it is a row of posters.
 */
const toKnownFor = (credits: any): Media[] => {
    const entries = [ ...(credits?.cast || []), ...(credits?.crew || []) ]
        .filter((entry: any) => entry.poster_path && isMediaType(entry.media_type));

    const seen = new Set<string>();
    const media: Media[] = [];

    for (const entry of entries.sort((a: any, b: any) => Number(b.popularity || 0) - Number(a.popularity || 0))) {
        const key = `${ entry.media_type }:${ entry.id }`;

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        media.push(toMedia(entry, entry.media_type));

        if (media.length >= KNOWN_FOR_LIMIT) {
            break;
        }
    }

    return media;
};

export async function fetchPersonDetails(id: number, language: string): Promise<PersonDetails | null> {
    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/person/${ id }`, {
            params: {
                api_key: apiKey(),
                language,
                append_to_response: "combined_credits,external_ids"
            }
        });

        const data = res.data;
        const credits = data.combined_credits;

        return {
            id: data.id,
            name: data.name || "",
            department: data.known_for_department || "",
            // TMDB leaves the biography empty rather than falling back, so a Hungarian
            // page would simply have none. The English one is better than a blank page
            biography: data.biography || "",
            birthday: data.birthday || null,
            deathday: data.deathday || null,
            place_of_birth: data.place_of_birth || "",
            profile_img: image(data.profile_path, "h632"),
            imdb_id: data.external_ids?.imdb_id || null,
            homepage: data.homepage || "",
            known_for: toKnownFor(credits),
            cast: toCredits(credits?.cast || [], (entry) => entry.character || ""),
            crew: toCredits(credits?.crew || [], (entry) => entry.job || "")
        };

    } catch(err) {
        await logTmdbFailure(err);
    }

    return null;
}

/**
 * Language in the key, like every other read here: the biography and the localised titles
 * are different answers per reader.
 */
export async function getPersonDetails(id: number, language?: string): Promise<PersonDetails | null> {
    const wanted = language || await readerLanguage();

    return await cached(
        `person:${ wanted }:${ id }`,
        () => fetchPersonDetails(id, wanted),
        (value) => value === null
    );
}

/**
 * The biography in the reader's language, or the English one when TMDB has none. Asked as
 * a second, cached request rather than always fetching both: for an English reader the
 * first answer is already the fallback, and for a Hungarian one an empty biography is the
 * common case — TMDB has few of them translated.
 */
export async function getPersonBiography(person: PersonDetails): Promise<string> {
    if (person.biography || await readerLanguage() === RECORD_LANGUAGE) {
        return person.biography;
    }

    const fallback = await getPersonDetails(person.id, RECORD_LANGUAGE);

    return fallback?.biography || "";
}
