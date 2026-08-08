import { TorrentStatus } from "@/lib/torrent";

// how long a download may sit still before it is given up on
const STALL_MS = Number(process.env.STALL_MINUTES || 60) * 60 * 1000;

// a half finished file is not worth keeping, but the deletion is a real one
export const STALL_DELETE_FILES = process.env.STALL_DELETE_FILES !== "0";

export const stallMinutes = () => Math.round(STALL_MS / 60000);

type StallEntry = { progress: number, since: number };

/**
 * How long a torrent has been standing still, and which releases turned out to be
 * dead. Both live in memory on purpose: a restart only means the clock starts over,
 * which at an hour long threshold changes nothing, and it saves a migration for a
 * value that is meaningless the moment the process ends.
 */
const globalForStall = global as unknown as {
    stallClock: Map<string, StallEntry>,
    stalledTitles: Set<string>
};

const clock = globalForStall.stallClock || new Map<string, StallEntry>();
globalForStall.stallClock = clock;

const stalledTitles = globalForStall.stalledTitles || new Set<string>();
globalForStall.stalledTitles = stalledTitles;

/**
 * qBittorrent's own verdict comes first: `stalledDL` is "downloading, but nothing
 * is coming in", and `metaDL` is a magnet whose metadata never arrived. Zero speed
 * covers the rest.
 *
 * `stalledUP` is *not* one of these: it is a finished torrent seeding to nobody,
 * which is the normal end state of every download here.
 */
const isStalling = (torrent: TorrentStatus) => {
    if (torrent.isComplete || torrent.isFailed) {
        return false;
    }

    return torrent.state === "stalledDL" || torrent.state === "metaDL" || torrent.downloadSpeed === 0;
};

/**
 * Call once per sync with the current state. Returns true when the torrent has not
 * moved for the whole threshold — the clock restarts on any progress at all, so a
 * slow download is never mistaken for a dead one.
 */
export const trackStall = (torrent: TorrentStatus, now = Date.now()): boolean => {
    const key = torrent.hash.toLowerCase();

    if (! isStalling(torrent)) {
        clock.delete(key);

        return false;
    }

    const known = clock.get(key);

    if (! known || torrent.progress > known.progress) {
        clock.set(key, { progress: torrent.progress, since: now });

        return false;
    }

    return now - known.since >= STALL_MS;
};

export const stalledFor = (hash: string, now = Date.now()) => {
    const known = clock.get(hash.toLowerCase());

    return known ? Math.round((now - known.since) / 60000) : 0;
};

export const forgetStall = (hash: string) => {
    clock.delete(hash.toLowerCase());
};

/**
 * A release that had to be thrown away is remembered by its name, so the search that
 * follows does not pick it again — whether it stalled or turned out not to be the
 * release at all (see `payload.ts`). qBittorrent names a torrent after the release it
 * came from, which is what makes this match.
 */
export const blockTitle = (normalized: string) => {
    if (normalized) {
        stalledTitles.add(normalized);
    }
};

export const isTitleBlocked = (normalized: string) => stalledTitles.has(normalized);

export const clearBlockedTitles = () => stalledTitles.clear();
