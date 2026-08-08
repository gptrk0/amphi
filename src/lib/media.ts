import {
    Media,
    MediaCompany,
    MediaDetails,
    MediaGenre,
    MediaMetadata,
    MediaPage,
    MediaPerson,
    MediaSeason
} from "@/types/media";
import axios from "axios";

import { loadSettings, settingNumber, settingText } from "@/lib/settings";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const apiKey = () => settingText("TMDB_API_KEY");
const language = () => settingText("TMDB_LANGUAGE");

// certifications and streaming services are per country, and the language already
// carries one — "en-US" means the US ratings board and US providers
const region = () => (settingText("TMDB_REGION") || language().split("-")[1] || "US").toUpperCase();

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

export async function fetchMediaMetadata(type: string, id: number): Promise<MediaMetadata | null> {
    if (! isMediaType(type)) {
        return null;
    }

    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/${ type }/${ id }`, {
            params: {
                api_key: apiKey(),
                language: language()
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
        console.error(err);
    }

    return null;
}

export async function getMediaMetadata(type: string, id: number): Promise<MediaMetadata | null> {
    return await cached(
        `metadata:${ type }:${ id }`,
        () => fetchMediaMetadata(type, id),
        (value) => value === null
    );
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
                language: language(),
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
        console.error(err);
    }

    return { results: [], page, totalPages: 0 };
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

export async function fetchDiscoverPage({ type, category, page, genre }: DiscoverOptions): Promise<MediaPage> {
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
                language: language(),
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
        console.error(err);
    }

    return { results: [], page, totalPages: 0 };
}

export async function getDiscoverPage(options: DiscoverOptions): Promise<MediaPage> {
    return await cached(
        `discover:${ options.type }:${ options.category }:${ options.genre || "" }:${ options.page }`,
        () => fetchDiscoverPage(options),
        (value) => value.results.length === 0,
        discoverTtlMs()
    );
}

export async function fetchGenres(type: string): Promise<MediaGenre[]> {
    if (! isMediaType(type)) {
        return [];
    }

    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/genre/${ type }/list`, {
            params: {
                api_key: apiKey(),
                language: language()
            }
        });

        return (res.data.genres || []).map((v: any) => ({ id: v.id, name: v.name }));

    } catch(err) {
        console.error(err);
    }

    return [];
}

export async function getGenres(type: string): Promise<MediaGenre[]> {
    return await cached(`genres:${ type }`, () => fetchGenres(type), (value) => value.length === 0);
}

export async function fetchImdbId(type: string, id: number): Promise<string | null> {
    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/${ type }/${ id }/external_ids`, {
            params: { api_key: apiKey() }
        });

        return res.data?.imdb_id || null;

    } catch(err) {
        console.error(err);
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
 * The age rating of the configured region. Films carry it per release, shows have
 * one per country.
 */
const toCertification = (data: any, type: Media["type"]): string | null => {
    if (type === "tv") {
        const found = (data.content_ratings?.results || []).find((v: any) => v.iso_3166_1 === region());

        return found?.rating || null;
    }

    const found = (data.release_dates?.results || []).find((v: any) => v.iso_3166_1 === region());
    const rated = (found?.release_dates || []).find((v: any) => v.certification);

    return rated?.certification || null;
};

const toRow = (value: any, type: Media["type"]): Media[] => {
    return (value?.results || [])
        .filter((item: any) => item.poster_path)
        .slice(0, ROW_LIMIT)
        .map((item: any) => toMedia(item, isMediaType(item.media_type) ? item.media_type : type));
};

export async function fetchMediaDetails(type: string, id: number): Promise<MediaDetails | null> {
    if (! isMediaType(type)) {
        return null;
    }

    const isTv = type === "tv";

    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/${ type }/${ id }`, {
            params: {
                api_key: apiKey(),
                language: language(),
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
                include_video_language: `${ language().split("-")[0] },en,null`
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
            certification: toCertification(data, type),
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
        console.error(err);
    }

    return null;
}

export async function getMediaDetails(type: string, id: number): Promise<MediaDetails | null> {
    return await cached(
        `details:${ type }:${ id }`,
        () => fetchMediaDetails(type, id),
        (value) => value === null
    );
}

/**
 * Seasons and episodes of a show, with air dates. Season 0 (specials) is skipped.
 */
export async function fetchTvSeasons(id: number): Promise<MediaSeason[]> {
    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/tv/${ id }`, {
            params: {
                api_key: apiKey(),
                language: language()
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
                    language: language()
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
        console.error(err);
    }

    return [];
}

export async function getTvSeasons(id: number): Promise<MediaSeason[]> {
    return await cached(
        `seasons:${ id }`,
        () => fetchTvSeasons(id),
        (value) => value.length === 0
    );
}
