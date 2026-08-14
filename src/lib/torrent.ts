import axios, { AxiosRequestConfig } from "axios";

import { IndexerResult } from "@/lib/indexer";
import { errorText, LogLevel, logThrottled } from "@/lib/log";
import { TorrentFile } from "@/lib/payload";
import { loadSettings, NotConfiguredError, settingText } from "@/lib/settings";

// the client is read back every minute, and the watchlist page asks for it every few
// seconds — one line a minute per kind of failure is plenty
const FAILURE_WINDOW_MS = 60 * 1000;

const logFailure = (what: string, err: unknown) => {
    // a client nobody has configured is not a failure worth repeating: the scheduler says
    // it once at startup, and an api route asked to download answers with the reason
    if (err instanceof NotConfiguredError) {
        return;
    }

    const text = errorText(err);

    return logThrottled(`torrent:${ what }:${ text }`, FAILURE_WINDOW_MS, LogLevel.WARN, "torrent", `qBittorrent: ${ what } failed`, text);
};

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
    /// How long this has been complete, in seconds, as the client counts it — qBittorrent's
    /// `seeding_time`. Not the app's own clock: a torrent that was already seeding before
    /// the app noticed it, or one that is paused, is only honest about it from here.
    seedingTime: number;
};

const category = () => settingText("TORRENT_CATEGORY");

// The four tag builders that used to live here (`aioseerr-manual`, `aioseerr-movie-…`,
// `-episode-…`, `-season-…`) are gone with the name: nothing had called them since the
// library became one row per download, and every tag this app writes now comes from
// `libraryTag`. Tags in that shape still exist in the client from older versions — see the
// note on `libraryTag` — and they are exactly what nothing here should be matching.

const COMPLETE_STATES = [ "uploading", "stalledUP", "pausedUP", "stoppedUP", "queuedUP", "forcedUP", "checkingUP" ];
const FAILED_STATES = [ "error", "missingFiles" ];

const baseUrl = () => settingText("TORRENT_URL").replace(/\/+$/, "");

// qBittorrent 5.x answers 204 to /auth/login when the client is whitelisted, which
// the @robertklep/qbittorrent client treats as an error — hence this minimal client.
const globalForTorrent = global as unknown as { qbitSid: string | null };

export const isClientConfigured = () => !! baseUrl();

const request = async (path: string, config: AxiosRequestConfig = {}, retryOnAuthError = true): Promise<any> => {
    await loadSettings();

    // without a url axios would fail on `"/api/v2/app/version" cannot be parsed as a URL`,
    // which tells a first time user nothing about what to do
    if (! isClientConfigured()) {
        throw new NotConfiguredError("The torrent client", "Torrent client");
    }

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
        seeds: Number(torrent.num_seeds || 0),
        // negative on an incomplete torrent in some versions, hence the clamp
        seedingTime: Math.max(Number(torrent.seeding_time || 0), 0)
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
        await logFailure(`making sure the "${ wanted }" category exists`, err);
    }
};

export const listManagedTorrents = async (): Promise<TorrentStatus[]> => {
    try {
        const list = await request("/api/v2/torrents/info", { params: { category: category() } });

        return Array.isArray(list) ? list.map(toStatus) : [];

    } catch(err) {
        await logFailure("listing the managed torrents", err);

        return [];
    }
};

export const getTorrentStatus = async (hash: string): Promise<TorrentStatus | null> => {
    try {
        const list = await request("/api/v2/torrents/info", { params: { hashes: hash } });

        return Array.isArray(list) && list.length > 0 ? toStatus(list[0]) : null;

    } catch(err) {
        await logFailure("looking a torrent up by hash", err);

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
        await logFailure("reading the file list of a torrent", err);

        return [];
    }
};

/**
 * The torrent an add just created, recognised by the tag it was given.
 *
 * `ignore` is what the client already held a moment earlier, and skipping it is the point:
 * a tag says "somebody wanted this to be found by that name", not "this is the torrent
 * that was just added". One that was already there under the same tag belongs to whoever
 * put it there — a run of this app with its own database, or an install sharing the client
 * — and taking it would tie the row to a torrent it never asked for.
 */
const findAddedTorrentByTag = async (tag: string, ignore: Set<string>): Promise<TorrentStatus | null> => {
    const torrents = await listManagedTorrents();

    const found = torrents.find(torrent => torrent.tags.includes(tag) && ! ignore.has(torrent.hash.toLowerCase()));

    return found || null;
};

// enough to recognise the same release under a different punctuation
const sameName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * qBittorrent ignores a torrent it already has: the add answers "Ok." and nothing
 * new appears, so the tag lookup finds nothing. The release is already in the
 * client though, and that is the one thing the caller wants to know.
 */
const findTorrentByName = async (title: string): Promise<TorrentStatus | null> => {
    const torrents = await listManagedTorrents();
    const wanted = sameName(title);

    return torrents.find(torrent => sameName(torrent.name) === wanted) || null;
};

/**
 * The same lookup across every category, and only ever to explain a failure.
 *
 * A torrent the client already holds under somebody else's category is invisible to
 * `listManagedTorrents`, so an add for it answers "Ok.", adds nothing, and leaves the app
 * with no idea why. It is not adopted — it is not this app's torrent and its files may be
 * anywhere — but it is by far the most common answer to "why did nothing happen", and a log
 * line that names it is the difference between a mystery and a two second explanation.
 */
const findAnywhereByName = async (title: string): Promise<{ torrent: TorrentStatus, category: string } | null> => {
    try {
        const list = await request("/api/v2/torrents/info");
        const wanted = sameName(title);

        const found = (Array.isArray(list) ? list : [])
            .find((torrent: any) => sameName(String(torrent.name || "")) === wanted);

        return found ? { torrent: toStatus(found), category: String(found.category || "") } : null;

    } catch {
        // this call only exists to write a better sentence, so it never becomes the failure
        return null;
    }
};

export const addTag = async (hash: string, tag: string) => {
    try {
        return await request("/api/v2/torrents/addTags", form({ hashes: hash, tags: tag }));

    } catch(err) {
        await logFailure("tagging a torrent", err);
    }
};

/**
 * What an add came to. `hash` is the torrent to follow; `reason` is why there is none, in
 * words meant for the log — the caller has nothing else to go on, since the client answers
 * a refusal and a success with almost the same thing.
 */
export type AddedRelease = { hash: string | null, reason: string | null };

const ADD_ATTEMPTS = 10;
const ADD_INTERVAL_MS = 500;

/**
 * What the add answered, from either shape the client speaks.
 *
 * qBittorrent 5.2 replies with a JSON summary — `{"added_torrent_ids":[],"failure_count":0,
 * "pending_count":1,"success_count":0}` — which is the difference between "refused" and
 * "still fetching your link", and the app had no way to tell those apart before. Older
 * versions answer `Ok.` or `Fails.` as plain text.
 *
 * The hashes in `added_torrent_ids` are deliberately not used to skip the tag lookup: they
 * are torrent *ids*, which are the infohash for an ordinary torrent and need not be for a
 * hybrid one, and every other hash in this app comes from `/torrents/info`. One shape of
 * hash, from one place.
 */
type AddAnswer = { failed: number, pending: number, refused: string | null };

const readAddAnswer = (data: unknown): AddAnswer => {
    if (data && typeof data === "object") {
        const summary = data as Record<string, unknown>;

        return {
            failed: Number(summary.failure_count || 0),
            pending: Number(summary.pending_count || 0),
            refused: null
        };
    }

    const text = String(data ?? "").trim();

    // "Ok." is the success and an empty body is one on some versions; anything else —
    // "Fails." above all — is the client saying no while still answering 200
    return {
        failed: 0,
        pending: 0,
        refused: text && text.toLowerCase() !== "ok." ? text : null
    };
};

/**
 * The add endpoint only answers "Ok.", so the hash is read back by the tag we set.
 * An empty `savePath` leaves the destination to qBittorrent, which is what the
 * category is already configured for.
 *
 * A release the client already holds never turns up under the new tag, so the last
 * word is a lookup by name — that one is adopted and tagged, because "you already
 * have this" is a started download, not a failed one.
 *
 * The client is read once **before** the add, because the tag alone cannot tell the
 * torrent this call created from one that was carrying that tag already. Fetching the
 * `.torrent` from the indexer takes about a second, so an older namesake would win that
 * race every single time — which is how a Silo episode ended up following a Regular Show
 * torrent on 2026-08-11. Only a hash that was not there a moment ago is this add's.
 *
 * **Every way this can fail comes back as a sentence.** There are three, and until now all
 * three came out of here as a bare `null` that the log could only report as "the client did
 * not take it": the call itself failing, which also used to throw and take the rest of the
 * scan round with it; the client answering `Fails.`, which was read as a success and then
 * timed out on the tag lookup; and the add being accepted while nothing appears, which is
 * almost always a link the client could not fetch or a torrent it already holds elsewhere.
 * The last one is worth a lookup of its own — see `findAnywhereByName`.
 */
export const addRelease = async (release: IndexerResult, tag: string, savePath = ""): Promise<AddedRelease> => {
    await ensureCategory();

    try {
        const before = new Set((await listManagedTorrents()).map(torrent => torrent.hash.toLowerCase()));

        const answer = readAddAnswer(await request("/api/v2/torrents/add", form({
            urls: release.link,
            category: category(),
            tags: tag,
            ...(savePath ? { savepath: savePath } : {})
        })));

        if (answer.refused) {
            return { hash: null, reason: `the client refused the link and answered "${ answer.refused }"` };
        }

        // it read the link and would have nothing to show for it, so there is no point
        // waiting five seconds to find that out
        if (answer.failed > 0 && answer.pending === 0) {
            return { hash: null, reason: `the client refused the link outright and added nothing (${ answer.failed } failed)` };
        }

        for (let attempt = 0; attempt < ADD_ATTEMPTS; attempt++) {
            const torrent = await findAddedTorrentByTag(tag, before);

            if (torrent) {
                return { hash: torrent.hash, reason: null };
            }

            await sleep(ADD_INTERVAL_MS);
        }

        const existing = await findTorrentByName(release.title);

        if (existing) {
            await addTag(existing.hash, tag);

            return { hash: existing.hash, reason: null };
        }

        const seconds = Math.round(ADD_ATTEMPTS * ADD_INTERVAL_MS / 1000);
        const elsewhere = await findAnywhereByName(release.title);

        if (elsewhere) {
            const where = elsewhere.category ? `under the "${ elsewhere.category }" category` : "with no category set";

            return {
                hash: null,
                reason: `the client already holds this torrent ${ where } (${ elsewhere.torrent.state }), so the add was`
                    + ` ignored — this app only follows "${ category() }", so it never saw it appear`
            };
        }

        return {
            hash: null,
            reason: `the client took the add and showed no torrent for ${ seconds }s;`
                + ` it fetches the link itself, so the usual cause is that ${ release.link.slice(0, 120) } did not answer with a torrent file`
        };

    } catch(err) {
        // Not rethrown: one release the client will not take must not end the round. It
        // used to, and the only trace was "the scan round failed" with everything after it
        // silently skipped.
        const text = errorText(err);

        // qBittorrent answers `409 Conflict` to anything it cannot make sense of and `415`
        // to a link that did not turn out to be a torrent file. Neither word says that by
        // itself, and "Conflict" in a log is a question rather than an answer.
        const status = text.match(/failed: (\d{3})/)?.[1];

        const hint = status === "409" ? " — the client could not make sense of the link"
            : status === "415" ? " — the link did not answer with a torrent file"
                : "";

        return { hash: null, reason: `${ text }${ hint }` };
    }
};

export const removeTorrent = async (hash: string, deleteFiles = false) => {
    try {
        return await request("/api/v2/torrents/delete", form({ hashes: hash, deleteFiles }));

    } catch(err) {
        // the caller has already written off the torrent, so a failure here leaves it in
        // the client with nothing pointing at it — the one case worth an unthrottled line
        await logThrottled(
            `torrent:delete:${ hash }`,
            FAILURE_WINDOW_MS,
            LogLevel.WARN,
            "torrent",
            `qBittorrent: torrent ${ hash.slice(0, 8) } could not be removed, it is still in the client`,
            errorText(err)
        );
    }
};
