import axios, { AxiosRequestConfig } from "axios";

import { IndexerResult } from "@/lib/indexer";
import { TorrentFile } from "@/lib/payload";
import { settingText } from "@/lib/settings";

export type TorrentStatus = {
    hash: string;
    name: string;
    progress: number;
    state: string;
    tags: string[];
    isComplete: boolean;
    isFailed: boolean;
    size: number;
    downloadSpeed: number;
    // seconds, null when qBittorrent cannot tell yet
    eta: number | null;
    seeds: number;
};

const category = () => settingText("TORRENT_CATEGORY", "aioseerr");

export const MANUAL_TAG = "aioseerr-manual";

export const movieTag = (watchlistId: number) => `aioseerr-movie-${ watchlistId }`;
export const episodeTag = (unitId: number) => `aioseerr-episode-${ unitId }`;
export const seasonTag = (watchlistId: number, seasonNumber: number) => `aioseerr-season-${ watchlistId }-${ seasonNumber }`;

const COMPLETE_STATES = [ "uploading", "stalledUP", "pausedUP", "stoppedUP", "queuedUP", "forcedUP", "checkingUP" ];
const FAILED_STATES = [ "error", "missingFiles" ];

const baseUrl = () => settingText("TORRENT_URL").replace(/\/+$/, "");

// qBittorrent 5.x answers 204 to /auth/login when the client is whitelisted, which
// the @robertklep/qbittorrent client treats as an error — hence this minimal client.
const globalForTorrent = global as unknown as { qbitSid: string | null };

const request = async (path: string, config: AxiosRequestConfig = {}, retryOnAuthError = true): Promise<any> => {
    const res = await axios.request({
        url: `${ baseUrl() }${ path }`,
        method: config.method || "get",
        headers: {
            Referer: baseUrl(),
            ...(globalForTorrent.qbitSid ? { Cookie: globalForTorrent.qbitSid } : {}),
            ...config.headers
        },
        params: config.params,
        data: config.data,
        validateStatus: () => true
    });

    if ((res.status === 401 || res.status === 403) && retryOnAuthError) {
        await login();

        return await request(path, config, false);
    }

    if (res.status < 200 || res.status >= 300) {
        throw new Error(`qBittorrent ${ path } failed: ${ res.status } ${ String(res.data).slice(0, 100) }`);
    }

    return res.data;
};

const login = async () => {
    const res = await axios.post(
        `${ baseUrl() }/api/v2/auth/login`,
        new URLSearchParams({
            username: settingText("TORRENT_USER"),
            password: settingText("TORRENT_PASS")
        }),
        {
            headers: {
                Referer: baseUrl(),
                "Content-Type": "application/x-www-form-urlencoded"
            },
            validateStatus: () => true
        }
    );

    if (res.status === 200 && String(res.data).trim() === "Fails.") {
        throw new Error("qBittorrent login failed: wrong credentials");
    }

    const cookie = (res.headers["set-cookie"] || []).find((v: string) => v.startsWith("SID="));

    globalForTorrent.qbitSid = cookie ? cookie.split(";")[0] : null;
};

const form = (fields: Record<string, string | number | boolean>) => {
    const body = new URLSearchParams();

    for (const [ key, value ] of Object.entries(fields)) {
        body.set(key, String(value));
    }

    return {
        method: "post" as const,
        data: body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// qBittorrent reports a hundred days when it has no estimate
const UNKNOWN_ETA = 8640000;

const toStatus = (torrent: any): TorrentStatus => {
    const state = String(torrent.state || "");
    const progress = Number(torrent.progress || 0);
    const eta = Number(torrent.eta || 0);

    return {
        hash: String(torrent.hash || ""),
        name: String(torrent.name || ""),
        progress,
        state,
        tags: String(torrent.tags || "").split(",").map((v: string) => v.trim()).filter(Boolean),
        isComplete: progress >= 1 || COMPLETE_STATES.includes(state),
        isFailed: FAILED_STATES.includes(state),
        size: Number(torrent.size || 0),
        downloadSpeed: Number(torrent.dlspeed || 0),
        eta: eta > 0 && eta < UNKNOWN_ETA ? eta : null,
        seeds: Number(torrent.num_seeds || 0)
    };
};

export const getClientVersion = async (): Promise<string> => {
    return String(await request("/api/v2/app/version"));
};

// the name, not a yes/no: the category is a setting now, and a changed one has to be
// created in the client too
let checkedCategory: string | null = null;

const ensureCategory = async () => {
    const wanted = category();

    if (checkedCategory === wanted) {
        return;
    }

    try {
        const categories = await request("/api/v2/torrents/categories");

        if (! categories || ! categories[wanted]) {
            await request("/api/v2/torrents/createCategory", form({ category: wanted, savePath: "" }));
        }

        checkedCategory = wanted;

    } catch(err) {
        console.error(err);
    }
};

export const listManagedTorrents = async (): Promise<TorrentStatus[]> => {
    try {
        const list = await request("/api/v2/torrents/info", { params: { category: category() } });

        return Array.isArray(list) ? list.map(toStatus) : [];

    } catch(err) {
        console.error(err);

        return [];
    }
};

export const getTorrentStatus = async (hash: string): Promise<TorrentStatus | null> => {
    try {
        const list = await request("/api/v2/torrents/info", { params: { hashes: hash } });

        return Array.isArray(list) && list.length > 0 ? toStatus(list[0]) : null;

    } catch(err) {
        console.error(err);

        return null;
    }
};

/**
 * What is inside the torrent. Empty until the metadata arrives, which for a magnet
 * can take a while — an empty list means "not known yet", not "nothing in it".
 */
export const getTorrentFiles = async (hash: string): Promise<TorrentFile[]> => {
    try {
        const files = await request("/api/v2/torrents/files", { params: { hash } });

        return (Array.isArray(files) ? files : []).map((file: any) => ({
            name: String(file.name || ""),
            size: Number(file.size || 0)
        }));

    } catch(err) {
        console.error(err);

        return [];
    }
};

export const findTorrentByTag = async (tag: string): Promise<TorrentStatus | null> => {
    const torrents = await listManagedTorrents();

    return torrents.find(torrent => torrent.tags.includes(tag)) || null;
};

/**
 * The add endpoint only answers "Ok.", so the hash is read back by the tag we set.
 * An empty `savePath` leaves the destination to qBittorrent, which is what the
 * category is already configured for.
 */
export const addRelease = async (release: IndexerResult, tag: string, savePath = ""): Promise<string | null> => {
    await ensureCategory();

    await request("/api/v2/torrents/add", form({
        urls: release.link,
        category: category(),
        tags: tag,
        ...(savePath ? { savepath: savePath } : {})
    }));

    for (let attempt = 0; attempt < 10; attempt++) {
        const torrent = await findTorrentByTag(tag);

        if (torrent) {
            return torrent.hash;
        }

        await sleep(500);
    }

    return null;
};

export const removeTorrent = async (hash: string, deleteFiles = false) => {
    try {
        return await request("/api/v2/torrents/delete", form({ hashes: hash, deleteFiles }));

    } catch(err) {
        console.error(err);
    }
};
