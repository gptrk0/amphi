import { ContentType, WatchStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { executeMovieGrab, executeSeasonGrab, planMovieGrab, planSeasonGrab, planSeasonGrabs } from "@/lib/grab";
import { getMediaMetadata, getTvSeasons } from "@/lib/media";
import { normalizeTitle } from "@/lib/release";
import { blockTitle, forgetStall, STALL_DELETE_FILES, stallMinutes, trackStall } from "@/lib/stall";
import { getTorrentStatus, listManagedTorrents, removeTorrent, TorrentStatus } from "@/lib/torrent";
import {
    ensureMovieUnit,
    forgetUnits,
    markUnitsDownloading,
    pruneWatchlistItem,
    syncTvSeasons,
    toAirDate
} from "@/lib/watchlist";

const SCAN_INTERVAL_MS = Number(process.env.WATCHLIST_SCAN_INTERVAL_MINUTES || 15) * 60 * 1000;

// Reading the client's state back is one local request, while a scan round is
// dozens of indexer calls — so noticing that something finished does not have to
// wait for the next round.
const SYNC_INTERVAL_MS = Number(process.env.DOWNLOAD_SYNC_INTERVAL_MINUTES || 1) * 60 * 1000;
const BACKOFF_MS = Number(process.env.SEARCH_BACKOFF_MINUTES || 30) * 60 * 1000;
const MAX_BACKOFF_MS = Number(process.env.SEARCH_MAX_BACKOFF_HOURS || 24) * 60 * 60 * 1000;
const START_DELAY_MS = 15 * 1000;

// with SCAN_DRY_RUN=1 no torrent is added and no search state is written. syncDownloads
// is not affected: it only mirrors back what the client already reports.
const isDryRun = () => process.env.SCAN_DRY_RUN === "1";

const log = (message: string) => console.log(`[scheduler]${ isDryRun() ? " [dry-run]" : "" } ${ message }`);

// syncDownloads writes in dry-run as well, so its lines must not claim otherwise
const syncLog = (message: string) => console.log(`[scheduler] ${ message }`);

const globalForScheduler = global as unknown as {
    schedulerStarted: boolean,
    schedulerRunning: boolean,
    syncRunning: boolean
};

/**
 * The wait doubles with every fruitless search up to a cap, and nothing is ever
 * given up on: a release that is not out yet may show up in a month, so a hard
 * attempt limit would quietly stop watching exactly the titles that need watching.
 */
const backoffMs = (attempts: number) => Math.min(BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);

const waitText = (ms: number) => ms < 60 * 60 * 1000 ? `${ Math.round(ms / 60000) }m` : `${ Math.round(ms / 3600000) }h`;

/**
 * Coarse pre-filter for the query — the shortest wait any row can have. `isDue`
 * then applies the row's own backoff, so changing the env takes effect at once
 * instead of being frozen into a stored column.
 */
const dueFilter = () => {
    return {
        OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: new Date(Date.now() - BACKOFF_MS) } }
        ]
    };
};

const isDue = (unit: { searchAttempts: number, lastCheckedAt: Date | null }) => {
    return ! unit.lastCheckedAt || unit.lastCheckedAt.getTime() + backoffMs(unit.searchAttempts) <= Date.now();
};

/**
 * A torrent that lost the managed category is missing from the filtered list while
 * it is still there, so a miss is confirmed by a hash lookup — resetting the row on
 * a category change alone would start a duplicate download.
 */
const resolveTorrent = async (byHash: Map<string, TorrentStatus>, hash: string) => {
    const known = byHash.get(hash);

    if (known) {
        return known;
    }

    const torrent = await getTorrentStatus(hash);

    if (torrent) {
        syncLog(`torrent ${ hash.slice(0, 8) } is outside the managed category`);
    }

    return torrent;
};

/**
 * One torrent can cover several units — a season pack — so the log names the item
 * once and says how much of it the torrent carries.
 */
const unitLabel = (units: { episodeNumber: number | null, watchlist: { tmdbId: number } }[]) => {
    const tmdbId = units[0].watchlist.tmdbId;
    const episodes = units.filter(unit => unit.episodeNumber !== null).length;

    return episodes === 0 ? `movie ${ tmdbId }` : `show ${ tmdbId }, ${ episodes } episode(s)`;
};

/**
 * Reads download state back from qBittorrent. The loop runs over hashes rather than
 * units, because the episodes of a season pack are finished by one torrent at once.
 *
 * This runs in dry-run too: it starts nothing, it only records what the client
 * already did, and hiding that would leave a finished download stuck DOWNLOADING.
 */
export const syncDownloads = async (preloaded?: TorrentStatus[]) => {
    const torrents = preloaded || await listManagedTorrents();
    const byHash = new Map(torrents.map(torrent => [ torrent.hash.toLowerCase(), torrent ]));

    const units = await prisma.watchlistUnit.findMany({
        where: {
            status: { in: [ WatchStatus.DOWNLOADING, WatchStatus.DOWNLOADED ] },
            torrentHash: { not: null }
        },
        include: { watchlist: true }
    });

    const hashes = [ ...new Set(units.map(unit => String(unit.torrentHash).toLowerCase())) ];

    for (const hash of hashes) {
        const covered = units.filter(unit => String(unit.torrentHash).toLowerCase() === hash);
        const running = covered.filter(unit => unit.status === WatchStatus.DOWNLOADING);
        const done = covered.filter(unit => unit.status === WatchStatus.DOWNLOADED);
        const where = { id: { in: running.map(unit => unit.id) } };

        const torrent = await resolveTorrent(byHash, hash);

        if (! torrent) {
            // the same disappearance means two different things: a download that
            // never finished was cancelled or failed and is worth another search,
            // while a finished one was watched and cleaned up
            if (done.length > 0) {
                syncLog(`${ unitLabel(done) }: removed from the client after finishing, treated as watched and deleted`);

                await forgetUnits(done.map(unit => unit.id));
                await pruneWatchlistItem(done[0].watchlistId);
            }

            if (running.length > 0) {
                syncLog(`${ unitLabel(running) }: torrent is gone from the client, queued for a new search`);

                await prisma.watchlistUnit.updateMany({
                    where,
                    data: { status: WatchStatus.PENDING, torrentHash: null }
                });
            }

            continue;
        }

        if (running.length === 0) {
            continue;
        }

        if (torrent.isComplete) {
            syncLog(`${ unitLabel(running) }: downloaded (${ torrent.name })`);

            await prisma.watchlistUnit.updateMany({ where, data: { status: WatchStatus.DOWNLOADED } });

        } else if (torrent.isFailed) {
            syncLog(`${ unitLabel(running) }: torrent failed (${ torrent.state }), queued for a new search`);

            await prisma.watchlistUnit.updateMany({
                where,
                data: { status: WatchStatus.PENDING, torrentHash: null, searchAttempts: { increment: 1 } }
            });

        } else if (trackStall(torrent)) {
            // nothing has arrived for the whole threshold: the release is dead, not
            // slow. it goes with its files, is remembered so the next search does
            // not pick it again, and the units are due immediately
            syncLog(`${ unitLabel(running) }: stalled at ${ Math.round(torrent.progress * 100) }% for ${ stallMinutes() } minutes (${ torrent.state }), dropping it for another release`);

            if (isDryRun()) {
                log("stall handling is skipped in dry-run, the torrent stays");

                continue;
            }

            blockTitle(normalizeTitle(torrent.name));

            await removeTorrent(hash, STALL_DELETE_FILES);
            forgetStall(hash);

            await prisma.watchlistUnit.updateMany({
                where,
                data: {
                    status: WatchStatus.PENDING,
                    torrentHash: null,
                    searchAttempts: { increment: 1 },
                    lastCheckedAt: null
                }
            });
        }
    }
};

/**
 * `force` is the manual scan from the watchlist: look at everything monitored right
 * now, whether or not its backoff has elapsed and whether or not it is out yet.
 */
export type ScanOptions = { force?: boolean };

export const scanMovies = async (options: ScanOptions = {}) => {
    const units = await prisma.watchlistUnit.findMany({
        where: {
            watchlist: { type: ContentType.MOVIE },
            monitored: true,
            status: { in: [ WatchStatus.PENDING, WatchStatus.SEARCHING ] },
            ...(options.force ? {} : {
                // a film that is not out yet cannot be on a tracker; episodes are
                // held back by the same airDate, just in scanEpisodes
                AND: [ { OR: [ { airDate: null }, { airDate: { lte: new Date() } } ] } ],
                ...dueFilter()
            })
        },
        include: { watchlist: true }
    });

    for (const unit of options.force ? units : units.filter(isDue)) {
        const tmdbId = unit.watchlist.tmdbId;
        const plan = await planMovieGrab(tmdbId);

        if (plan?.release) {
            log(`movie ${ tmdbId }: grabbing ${ plan.release.title }`);

            if (! isDryRun()) {
                const started = await executeMovieGrab(tmdbId, plan.release);

                if (! started) {
                    await markUnitsDownloading([ unit.id ], null);
                }
            }

            continue;
        }

        const attempts = unit.searchAttempts + 1;

        log(`movie ${ tmdbId }: nothing suitable found (attempt ${ attempts }, next in ${ waitText(backoffMs(attempts)) })`);

        if (! isDryRun()) {
            await prisma.watchlistUnit.update({
                where: { id: unit.id },
                data: {
                    status: WatchStatus.SEARCHING,
                    searchAttempts: attempts,
                    lastCheckedAt: new Date()
                }
            });
        }
    }
};

/**
 * Episodes are searched one by one, and `shouldUsePack` decides when one season
 * torrent is the better answer.
 */
export const scanEpisodes = async (options: ScanOptions = {}) => {
    const found = await prisma.watchlistUnit.findMany({
        where: {
            status: { in: [ WatchStatus.PENDING, WatchStatus.SEARCHING ] },
            seasonNumber: { not: null },
            monitored: true,
            ...(options.force ? {} : {
                airDate: { not: null, lte: new Date() },
                ...dueFilter()
            })
        },
        include: { watchlist: true }
    });

    const due = options.force ? found : found.filter(isDue);

    const groups = new Map<string, { watchlistId: number, tmdbId: number, seasonNumber: number, units: typeof due }>();

    for (const unit of due) {
        if (unit.seasonNumber === null) {
            continue;
        }

        const key = `${ unit.watchlistId }:${ unit.seasonNumber }`;
        const group = groups.get(key) || {
            watchlistId: unit.watchlistId,
            tmdbId: unit.watchlist.tmdbId,
            seasonNumber: unit.seasonNumber,
            units: []
        };

        group.units.push(unit);
        groups.set(key, group);
    }

    for (const { watchlistId, tmdbId, seasonNumber, units } of groups.values()) {
        const episodeNumbers = units.map(unit => unit.episodeNumber).filter((v): v is number => v !== null);

        const plan = await planSeasonGrab(tmdbId, seasonNumber, { episodeNumbers, force: options.force });

        if (! plan) {
            continue;
        }

        const { usePack, grabs } = await planSeasonGrabs(watchlistId, plan, { episodeNumbers });

        for (const grab of grabs) {
            log(`show ${ tmdbId } S${ seasonNumber } ${ grab.isPack ? "pack" : `E${ grab.episodeNumbers.join(",E") }` }: grabbing ${ grab.release.title }`);
        }

        if (! isDryRun() && grabs.length > 0) {
            await executeSeasonGrab(tmdbId, plan, { episodeNumbers, usePack });
        }

        const grabbed = new Set(grabs.flatMap(grab => grab.episodeNumbers));

        for (const unit of units) {
            if (unit.episodeNumber === null || grabbed.has(unit.episodeNumber)) {
                continue;
            }

            const attempts = unit.searchAttempts + 1;

            log(`show ${ tmdbId } S${ seasonNumber }E${ unit.episodeNumber }: nothing found (attempt ${ attempts }, next in ${ waitText(backoffMs(attempts)) })`);

            if (! isDryRun()) {
                await prisma.watchlistUnit.update({
                    where: { id: unit.id },
                    data: {
                        status: WatchStatus.SEARCHING,
                        searchAttempts: attempts,
                        lastCheckedAt: new Date()
                    }
                });
            }
        }
    }
};

/**
 * Picks up new seasons, air date changes and release dates that TMDB moved. The
 * TMDB cache keeps this cheap.
 *
 * Like syncDownloads this writes in dry-run: it starts nothing, it only follows
 * TMDB — and the scanner holds unreleased units back by exactly these dates, so a
 * stale one would search for something that cannot exist yet.
 */
export const refreshMetadata = async () => {
    const items = await prisma.watchlist.findMany({
        where: {
            OR: [
                { type: ContentType.MOVIE },
                { type: ContentType.TV, units: { some: { monitored: true } } }
            ]
        }
    });

    for (const item of items) {
        if (item.type === ContentType.MOVIE) {
            const metadata = await getMediaMetadata("movie", item.tmdbId);

            if (metadata) {
                await ensureMovieUnit(item.id, toAirDate(metadata.media.date));
            }

            continue;
        }

        if ((await getTvSeasons(item.tmdbId)).length > 0) {
            await syncTvSeasons(item.id, item.tmdbId);
        }
    }
};

/**
 * The sync runs from three places — the scan round, its own short interval and
 * every live watchlist request — so it guards itself instead of relying on them.
 */
export const syncDownloadsOnce = async (preloaded?: TorrentStatus[]) => {
    if (globalForScheduler.syncRunning) {
        return false;
    }

    globalForScheduler.syncRunning = true;

    try {
        await syncDownloads(preloaded);

    } catch(err) {
        console.error("[scheduler] sync failed", err);

    } finally {
        globalForScheduler.syncRunning = false;
    }

    return true;
};

export const runScan = async (options: ScanOptions = {}) => {
    if (globalForScheduler.schedulerRunning) {
        log("previous run is still going, skipping this tick");

        return false;
    }

    globalForScheduler.schedulerRunning = true;

    if (options.force) {
        log("manual scan: every monitored item, backoff and release dates ignored");
    }

    try {
        await syncDownloadsOnce();
        await refreshMetadata();
        await scanMovies(options);
        await scanEpisodes(options);

    } catch(err) {
        console.error("[scheduler] run failed", err);

    } finally {
        globalForScheduler.schedulerRunning = false;
    }

    return true;
};

export const startScheduler = () => {
    if (globalForScheduler.schedulerStarted) {
        return;
    }

    globalForScheduler.schedulerStarted = true;

    log(`started, scanning every ${ SCAN_INTERVAL_MS / 60000 } minutes, reading the client back every ${ SYNC_INTERVAL_MS / 60000 }`);

    setTimeout(() => void runScan(), START_DELAY_MS);
    setInterval(() => void runScan(), SCAN_INTERVAL_MS);
    setInterval(() => void syncDownloadsOnce(), SYNC_INTERVAL_MS);
};
