import axios, { AxiosRequestConfig } from "axios";

import { IndexerResult } from "@/lib/indexer";

export type TorrentStatus = {
    hash: string;
    name: string;
    progress: number;
    state: string;
    tags: string[];
    isComplete: boolean;
    isFailed: boolean;
};

const CATEGORY = process.env.TORRENT_CATEGORY || "aioseerr";

export const MANUAL_TAG = "aioseerr-manual";

export const movieTag = (watchlistId: number) => `aioseerr-movie-${ watchlistId }`;
export const episodeTag = (episodeId: number) => `aioseerr-episode-${ episodeId }`;
export const seasonTag = (watchlistId: number, seasonNumber: number) => `aioseerr-season-${ watchlistId }-${ seasonNumber }`;

const COMPLETE_STATES = [ "uploading", "stalledUP", "pausedUP", "stoppedUP", "queuedUP", "forcedUP", "checkingUP" ];
const FAILED_STATES = [ "error", "missingFiles" ];

const baseUrl = () => (process.env.TORRENT_URL || "").replace(/\/+$/, "");

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
            username: process.env.TORRENT_USER || "",
            password: process.env.TORRENT_PASS || ""
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

const toStatus = (torrent: any): TorrentStatus => {
    const state = String(torrent.state || "");
    const progress = Number(torrent.progress || 0);

    return {
        hash: String(torrent.hash || ""),
        name: String(torrent.name || ""),
        progress,
        state,
        tags: String(torrent.tags || "").split(",").map((v: string) => v.trim()).filter(Boolean),
        isComplete: progress >= 1 || COMPLETE_STATES.includes(state),
        isFailed: FAILED_STATES.includes(state)
    };
};

export const getClientVersion = async (): Promise<string> => {
    return String(await request("/api/v2/app/version"));
};

let categoryChecked = false;

const ensureCategory = async () => {
    if (categoryChecked) {
        return;
    }

    try {
        const categories = await request("/api/v2/torrents/categories");

        if (! categories || ! categories[CATEGORY]) {
            await request("/api/v2/torrents/createCategory", form({ category: CATEGORY, savePath: "" }));
        }

        categoryChecked = true;

    } catch(err) {
        console.error(err);
    }
};

export const listManagedTorrents = async (): Promise<TorrentStatus[]> => {
    try {
        const list = await request("/api/v2/torrents/info", { params: { category: CATEGORY } });

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

export const findTorrentByTag = async (tag: string): Promise<TorrentStatus | null> => {
    const torrents = await listManagedTorrents();

    return torrents.find(torrent => torrent.tags.includes(tag)) || null;
};

/**
 * The add endpoint only answers "Ok.", so the hash is read back by the tag we set.
 */
export const addRelease = async (release: IndexerResult, tag: string): Promise<string | null> => {
    await ensureCategory();

    await request("/api/v2/torrents/add", form({
        urls: release.link,
        category: CATEGORY,
        tags: tag
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
