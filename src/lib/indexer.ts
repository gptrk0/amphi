import axios from "axios";
import { XMLParser } from "fast-xml-parser";

import { errorText, logDebug, LogLevel, logThrottled } from "@/lib/log";
import { loadSettings, settingList, settingNumber, settingText } from "@/lib/settings";

// an indexer that is down fails every search of a round, and a round is dozens of
// searches — so identical failures are folded into one line a minute
const FAILURE_WINDOW_MS = 60 * 1000;

const logFailure = (indexerId: string, what: string, description: string) => {
    return logThrottled(
        `indexer:${ indexerId }:${ what }:${ description }`,
        FAILURE_WINDOW_MS,
        LogLevel.WARN,
        "indexer",
        `${ indexerId }: the ${ what } failed`,
        description
    );
};

// capabilities can be wrong, or an indexer can reject a param it advertises — the search
// is retried by title, so this is only interesting when something is being chased down
const logImdbFallback = (indexerId: string, description: string) => {
    return logDebug("indexer", `${ indexerId } rejected the imdb id, searching by title instead`, description);
};

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

const globalForIndexer = global as unknown as {
    indexerCaps: Map<string, CapsCacheEntry>,
    // what the manager answered when nothing was named — see `searchIndexerIds`
    discoveredIds: { value: string[], expiresAt: number } | null
};

const capsCache = globalForIndexer.indexerCaps || new Map<string, CapsCacheEntry>();
globalForIndexer.indexerCaps = capsCache;

/**
 * The indexer ids somebody named, in the order they named them — which is also the
 * priority. Empty is not "none": it means every indexer the manager has, and finding out
 * which those are takes a call, so only `searchIndexerIds` can answer it.
 *
 * `all` is dropped rather than queried. It was this setting's default until 2026-08-16 and
 * Jackett does answer to it — that is the problem: the aggregate endpoint reports the
 * *union* of every indexer's capabilities, so one that cannot search by imdb id looks
 * exactly like one that can, and a whole round quietly falls back to matching by title. An
 * install that still has it stored gets the same convenience the honest way.
 */
export const getIndexerIds = (): string[] => {
    return settingList("INDEXER_IDS").filter(id => id.toLowerCase() !== "all");
};

type TorznabResponse = {
    data?: any;
    error?: { code: number, description: string };
};

/**
 * Not a throw: the scanner searches in a loop and an unconfigured indexer must not abort
 * a whole round. The api routes ask this before they promise the user anything.
 */
export const isIndexerConfigured = () => !! settingText("INDEXER_URL");

const request = async (indexerId: string, params: Record<string, string | number>): Promise<TorznabResponse> => {
    await loadSettings();

    if (! isIndexerConfigured()) {
        return { error: { code: 0, description: "no indexer url is configured" } };
    }

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
        await logFailure(indexerId, "request", errorText(err));

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
        await logFailure(indexerId, "capability lookup", res.error.description);

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
    globalForIndexer.discoveredIds = null;
};

export type IndexerEntry = { id: string, title: string };

/**
 * Every indexer the manager has set up, so the ids can be filled in from the settings page
 * instead of copied out of Jackett's own list by hand — one typo there and that indexer is
 * simply never searched, silently.
 *
 * Asked through the **torznab** endpoint (`t=indexers`), not Jackett's management API. That
 * one sits behind the dashboard's own password: `/api/v2.0/indexers?configured=true` with
 * this app's api key answers `400 Cookies required`, measured on 2026-08-15. The api key
 * opens the torznab endpoint and nothing else, so this is the whole of what can be asked
 * with what the app has.
 *
 * Not cached: it is asked when somebody presses a button, and the answer they want is the
 * one from that moment — an indexer they added a minute ago is the reason they pressed it.
 * The search path goes through `searchIndexerIds`, which is where the caching lives.
 *
 * `all` in the path is Jackett's aggregate endpoint being used as a route to ask this
 * question, not an indexer being searched — nothing else answers `t=indexers`.
 */
export const listIndexers = async (): Promise<{ indexers?: IndexerEntry[], error?: string }> => {
    const res = await request("all", { t: "indexers", configured: "true" });

    if (res.error) {
        await logFailure("all", "indexer listing", res.error.description);

        return { error: res.error.description };
    }

    const found = res.data?.indexers?.indexer;

    // one indexer is a single node rather than a list of one, and no indexers at all is a
    // missing node — neither is an error, they are answers
    const list = found ? (Array.isArray(found) ? found : [ found ]) : [];

    return {
        indexers: list
            // `configured=true` above already asks for this, and it is cheap to not depend
            // on a query parameter being honoured for something that decides what is saved
            .filter((entry: any) => String(entry?.["@_configured"] ?? "true") !== "false")
            .map((entry: any) => ({
                id: String(entry?.["@_id"] || ""),
                title: String(entry?.title || entry?.["@_id"] || "")
            }))
            .filter((entry: IndexerEntry) => !! entry.id)
    };
};

/**
 * The indexers a search actually runs on: the ones named in the setting, or — when nothing
 * is named — every one the manager has configured, each queried on its own so its own
 * capabilities decide the query.
 *
 * Cached for the capability TTL, unlike `listIndexers` itself: this is on the path of every
 * search and a scan round is dozens of them, while the button on the settings page is a
 * person asking about this minute.
 */
export const searchIndexerIds = async (): Promise<string[]> => {
    const named = getIndexerIds();

    if (named.length > 0) {
        return named;
    }

    const hit = globalForIndexer.discoveredIds;

    if (hit && hit.expiresAt > Date.now()) {
        return hit.value;
    }

    const { indexers } = await listIndexers();
    const ids = (indexers || []).map(entry => entry.id);

    if (ids.length === 0) {
        // nothing named and nothing found is a round that searches nothing at all, which
        // otherwise looks exactly like a round that found nothing. `listIndexers` says so
        // when the manager answered with an error; this is the quiet half
        await logFailure("all", "indexer discovery", "no indexer is named in the settings and the manager has none configured");

        // and it is not cached: a manager that was unreachable for a minute must not mean
        // six hours of searching nothing
        return [];
    }

    globalForIndexer.discoveredIds = { value: ids, expiresAt: Date.now() + capsTtlMs() };

    return ids;
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
        await logImdbFallback(indexerId, res.error.description);

        res = await request(indexerId, { t: mode, q: text });
    }

    if (res.error) {
        await logFailure(indexerId, "movie search", res.error.description);

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
        await logImdbFallback(indexerId, res.error.description);

        res = await request(indexerId, { ...params, q: query.title });
    }

    if (res.error) {
        await logFailure(indexerId, "episode search", res.error.description);

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
        await logFailure(indexerId, "season search", res.error.description);

        return [];
    }

    return parseItems(indexerId, res.data);
};

export const findMovieReleases = async (query: MovieQuery): Promise<IndexerResult[]> => {
    const results = await Promise.all((await searchIndexerIds()).map(id => findMovieReleasesOn(id, query)));

    return dedupe(results.flat());
};

export const findEpisodeReleases = async (query: EpisodeQuery): Promise<IndexerResult[]> => {
    const results = await Promise.all((await searchIndexerIds()).map(id => findEpisodeReleasesOn(id, query)));

    return dedupe(results.flat());
};

export const findSeasonReleases = async (query: SeasonQuery): Promise<IndexerResult[]> => {
    const results = await Promise.all((await searchIndexerIds()).map(id => findSeasonReleasesOn(id, query)));

    return dedupe(results.flat());
};
