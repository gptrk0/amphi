import axios from "axios";
import { XMLParser } from "fast-xml-parser";

import { loadSettings, settingList, settingNumber, settingText } from "@/lib/settings";

export type IndexerCaps = {
    search: string[];
    movie: string[];
    tv: string[];
};

export type IndexerResult = {
    indexerId: string;
    title: string;
    guid: string;
    link: string;
    pubDate: string;
    size: number;
    seeders: number;
    peers: number;
};

export type MovieQuery = {
    imdbId?: string | null;
    title: string;
    year?: string | null;
};

export type EpisodeQuery = {
    imdbId?: string | null;
    title: string;
    season: number;
    episode: number;
};

export type SeasonQuery = {
    imdbId?: string | null;
    title: string;
    season: number;
};

const capsTtlMs = () => settingNumber("INDEXER_CAPS_TTL_MINUTES") * 60 * 1000;

const EMPTY_CAPS: IndexerCaps = { search: [], movie: [], tv: [] };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type CapsCacheEntry = { value: IndexerCaps, expiresAt: number };

const globalForIndexer = global as unknown as { indexerCaps: Map<string, CapsCacheEntry> };
const capsCache = globalForIndexer.indexerCaps || new Map<string, CapsCacheEntry>();
globalForIndexer.indexerCaps = capsCache;

/**
 * Jackett indexer ids to query. Each one is queried separately so its own
 * capabilities decide the query: the aggregate endpoint reports the union of
 * capabilities, which makes imdbid support impossible to tell apart.
 */
export const getIndexerIds = (): string[] => {
    const ids = settingList("INDEXER_IDS");

    return ids.length > 0 ? ids : [ "all" ];
};

type TorznabResponse = {
    data?: any;
    error?: { code: number, description: string };
};

const request = async (indexerId: string, params: Record<string, string | number>): Promise<TorznabResponse> => {
    await loadSettings();

    try {
        const res = await axios.get(`${ settingText("INDEXER_URL") }/api/v2.0/indexers/${ indexerId }/results/torznab/api`, {
            params: {
                apikey: settingText("INDEXER_API_KEY"),
                ...params
            },
            validateStatus: () => true
        });

        const data = parser.parse(res.data);

        if (data?.error) {
            return {
                error: {
                    code: Number(data.error["@_code"]),
                    description: String(data.error["@_description"] || "")
                }
            };
        }

        if (res.status < 200 || res.status >= 300) {
            return { error: { code: res.status, description: `HTTP ${ res.status }` } };
        }

        return { data };

    } catch(err) {
        console.error(err);

        return { error: { code: 0, description: "Indexer request failed" } };
    }
};

const supportedParams = (node: any): string[] => {
    if (! node || node["@_available"] !== "yes") {
        return [];
    }

    return String(node["@_supportedParams"] || "")
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);
};

export const getCaps = async (indexerId: string): Promise<IndexerCaps> => {
    const hit = capsCache.get(indexerId);

    if (hit && hit.expiresAt > Date.now()) {
        return hit.value;
    }

    const res = await request(indexerId, { t: "caps" });

    if (res.error) {
        console.error(`[indexer] caps failed for ${ indexerId }: ${ res.error.description }`);

        return EMPTY_CAPS;
    }

    const searching = res.data?.caps?.searching || {};

    const caps: IndexerCaps = {
        search: supportedParams(searching.search),
        movie: supportedParams(searching["movie-search"]),
        tv: supportedParams(searching["tv-search"])
    };

    capsCache.set(indexerId, { value: caps, expiresAt: Date.now() + capsTtlMs() });

    return caps;
};

export const clearCapsCache = () => {
    capsCache.clear();
};

const attributes = (item: any): Record<string, string> => {
    const raw = item["torznab:attr"];

    if (! raw) {
        return {};
    }

    const list = Array.isArray(raw) ? raw : [ raw ];
    const out: Record<string, string> = {};

    for (const attr of list) {
        if (attr && attr["@_name"]) {
            out[attr["@_name"]] = String(attr["@_value"] ?? "");
        }
    }

    return out;
};

const parseItems = (indexerId: string, data: any): IndexerResult[] => {
    const raw = data?.rss?.channel?.item;

    if (! raw) {
        return [];
    }

    const items = Array.isArray(raw) ? raw : [ raw ];

    return items.map((item: any) => {
        const attrs = attributes(item);

        return {
            // in aggregate mode Jackett tags every item with the indexer it came from
            indexerId: String(item.jackettindexer?.["@_id"] || indexerId),
            title: String(item.title ?? ""),
            guid: String(item.guid ?? ""),
            link: String(item.link || item.enclosure?.["@_url"] || ""),
            pubDate: String(item.pubDate ?? ""),
            size: Number(item.size || item.enclosure?.["@_length"] || 0),
            seeders: Number(attrs.seeders || 0),
            peers: Number(attrs.peers || attrs.leechers || 0)
        };
    });
};

const episodeTag = (season: number, episode: number) => {
    return `S${ String(season).padStart(2, "0") }E${ String(episode).padStart(2, "0") }`;
};

const seasonTag = (season: number) => {
    return `S${ String(season).padStart(2, "0") }`;
};

const normalizeTitle = (title: string) => {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
};

/**
 * Same release can come from several indexers; keep the copy with the most seeders.
 */
export const dedupe = (results: IndexerResult[]): IndexerResult[] => {
    const best = new Map<string, IndexerResult>();

    for (const result of results) {
        const key = `${ normalizeTitle(result.title) }:${ result.size }`;
        const current = best.get(key);

        if (! current || result.seeders > current.seeders) {
            best.set(key, result);
        }
    }

    return [ ...best.values() ];
};

const findMovieReleasesOn = async (indexerId: string, query: MovieQuery): Promise<IndexerResult[]> => {
    const caps = await getCaps(indexerId);
    const mode = caps.movie.length > 0 ? "movie" : "search";
    const text = [ query.title, query.year ].filter(Boolean).join(" ");
    const useImdbId = !! query.imdbId && caps.movie.includes("imdbid");

    let res = useImdbId
        ? await request(indexerId, { t: mode, imdbid: query.imdbId as string })
        : await request(indexerId, { t: mode, q: text });

    // capabilities can be wrong or the indexer can reject the param anyway
    if (res.error && useImdbId) {
        console.error(`[indexer] ${ indexerId } rejected imdbid (${ res.error.description }), falling back to title search`);

        res = await request(indexerId, { t: mode, q: text });
    }

    if (res.error) {
        console.error(`[indexer] ${ indexerId } movie search failed: ${ res.error.description }`);

        return [];
    }

    return parseItems(indexerId, res.data);
};

const findEpisodeReleasesOn = async (indexerId: string, query: EpisodeQuery): Promise<IndexerResult[]> => {
    const caps = await getCaps(indexerId);

    if (caps.tv.length === 0) {
        const res = await request(indexerId, { t: "search", q: `${ query.title } ${ episodeTag(query.season, query.episode) }` });

        return res.error ? [] : parseItems(indexerId, res.data);
    }

    const useImdbId = !! query.imdbId && caps.tv.includes("imdbid");

    const params = {
        t: "tvsearch",
        season: query.season,
        ep: query.episode
    };

    let res = useImdbId
        ? await request(indexerId, { ...params, imdbid: query.imdbId as string })
        : await request(indexerId, { ...params, q: query.title });

    if (res.error && useImdbId) {
        console.error(`[indexer] ${ indexerId } rejected imdbid (${ res.error.description }), falling back to title search`);

        res = await request(indexerId, { ...params, q: query.title });
    }

    if (res.error) {
        console.error(`[indexer] ${ indexerId } tv search failed: ${ res.error.description }`);

        return [];
    }

    return parseItems(indexerId, res.data);
};

/**
 * Season search: tvsearch without the `ep` param, so season packs come back too.
 */
const findSeasonReleasesOn = async (indexerId: string, query: SeasonQuery): Promise<IndexerResult[]> => {
    const caps = await getCaps(indexerId);

    if (! caps.tv.includes("season")) {
        const res = await request(indexerId, { t: caps.tv.length > 0 ? "tvsearch" : "search", q: `${ query.title } ${ seasonTag(query.season) }` });

        return res.error ? [] : parseItems(indexerId, res.data);
    }

    const useImdbId = !! query.imdbId && caps.tv.includes("imdbid");

    let res = useImdbId
        ? await request(indexerId, { t: "tvsearch", season: query.season, imdbid: query.imdbId as string })
        : await request(indexerId, { t: "tvsearch", season: query.season, q: query.title });

    if (res.error && useImdbId) {
        res = await request(indexerId, { t: "tvsearch", season: query.season, q: query.title });
    }

    if (res.error) {
        console.error(`[indexer] ${ indexerId } season search failed: ${ res.error.description }`);

        return [];
    }

    return parseItems(indexerId, res.data);
};

export const findMovieReleases = async (query: MovieQuery): Promise<IndexerResult[]> => {
    const results = await Promise.all(getIndexerIds().map(id => findMovieReleasesOn(id, query)));

    return dedupe(results.flat());
};

export const findEpisodeReleases = async (query: EpisodeQuery): Promise<IndexerResult[]> => {
    const results = await Promise.all(getIndexerIds().map(id => findEpisodeReleasesOn(id, query)));

    return dedupe(results.flat());
};

export const findSeasonReleases = async (query: SeasonQuery): Promise<IndexerResult[]> => {
    const results = await Promise.all(getIndexerIds().map(id => findSeasonReleasesOn(id, query)));

    return dedupe(results.flat());
};
