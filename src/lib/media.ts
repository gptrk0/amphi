import { Media, MediaMetadata, MediaSearchPage, MediaSeason } from "@/types/media";
import axios from "axios";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || "en-US";

const CACHE_TTL_MS = Number(process.env.TMDB_CACHE_TTL_MINUTES || 720) * 60 * 1000;

type CacheEntry = { value: unknown, expiresAt: number };

// The watchlist stores ids only, so every listing and every scanner run reads TMDB.
// Kept on global so hot reload does not drop it.
const globalForTmdb = global as unknown as { tmdbCache: Map<string, CacheEntry> };
const tmdbCache = globalForTmdb.tmdbCache || new Map<string, CacheEntry>();
globalForTmdb.tmdbCache = tmdbCache;

const cached = async <T>(key: string, loader: () => Promise<T>, isEmpty: (value: T) => boolean): Promise<T> => {
    const hit = tmdbCache.get(key);

    if (hit && hit.expiresAt > Date.now()) {
        return hit.value as T;
    }

    const value = await loader();

    // never cache a failed lookup, otherwise a TMDB outage sticks
    if (! isEmpty(value)) {
        tmdbCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
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
                api_key: process.env.TMDB_API_KEY,
                language: TMDB_LANGUAGE
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
export async function searchMedia(query: string, page: number): Promise<MediaSearchPage> {
    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/search/multi`, {
            params: {
                api_key: process.env.TMDB_API_KEY,
                language: TMDB_LANGUAGE,
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

export async function fetchImdbId(type: string, id: number): Promise<string | null> {
    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/${ type }/${ id }/external_ids`, {
            params: { api_key: process.env.TMDB_API_KEY }
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

export async function fetchMediaDetails(type: string, id: number): Promise<Media | null> {
    const metadata = await getMediaMetadata(type, id);

    return metadata ? metadata.media : null;
}

/**
 * Seasons and episodes of a show, with air dates. Season 0 (specials) is skipped.
 */
export async function fetchTvSeasons(id: number): Promise<MediaSeason[]> {
    try {
        const res = await axios.get(`${ TMDB_BASE_URL }/tv/${ id }`, {
            params: {
                api_key: process.env.TMDB_API_KEY,
                language: TMDB_LANGUAGE
            }
        });

        let seasonNumbers: number[] = (res.data.seasons || [])
            .map((v: any) => v.season_number)
            .filter((v: number) => v > 0);

        // /tv/{id} only carries season headers, the episodes need one request per season
        let seasons = await Promise.all(seasonNumbers.map(async (seasonNumber) => {
            const seasonRes = await axios.get(`${ TMDB_BASE_URL }/tv/${ id }/season/${ seasonNumber }`, {
                params: {
                    api_key: process.env.TMDB_API_KEY,
                    language: TMDB_LANGUAGE
                }
            });

            let data = seasonRes.data;

            let season: MediaSeason = {
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
