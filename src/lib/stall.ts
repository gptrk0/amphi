import { TorrentStatus } from "@/lib/torrent";

// how long a download may sit still before it is given up on
const STALL_MS = Number(process.env.STALL_MINUTES || 60) * 60 * 1000;

// a half finished file is not worth keeping, but the deletion is a real one
export const STALL_DELETE_FILES = process.env.STALL_DELETE_FILES !== "0";

export const stallMinutes = () => Math.round(STALL_MS / 60000);

type StallEntry = { progress: number, since: number };

/**
 * How long a torrent has been standing still. This one stays in memory: a restart
 * only means the clock starts over, which at an hour long threshold changes nothing,
 * and it saves a migration for a value that is meaningless the moment the process
 * ends. The blocklist it used to keep company is a table now — see `blocklist.ts`,
 * where a restart forgetting things was a real problem.
 */
const globalForStall = global as unknown as { stallClock: Map<string, StallEntry> };

const clock = globalForStall.stallClock || new Map<string, StallEntry>();
globalForStall.stallClock = clock;

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

export const forgetStall = (hash: string) => {
    clock.delete(hash.toLowerCase());
};
