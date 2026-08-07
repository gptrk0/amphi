import { ContentType, WatchStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { executeMovieGrab, executeSeasonGrab, planGrabs, planMovieGrab, planSeasonGrab } from "@/lib/grab";
import { getTvSeasons } from "@/lib/media";
import { getTorrentStatus, listManagedTorrents, TorrentStatus } from "@/lib/torrent";
import { markUnitsDownloading, syncTvSeasons } from "@/lib/watchlist";

const SCAN_INTERVAL_MS = Number(process.env.WATCHLIST_SCAN_INTERVAL_MINUTES || 15) * 60 * 1000;
const BACKOFF_MS = Number(process.env.SEARCH_BACKOFF_MINUTES || 30) * 60 * 1000;
const MAX_ATTEMPTS = Number(process.env.MAX_SEARCH_ATTEMPTS || 10);
const PACK_AFTER_ATTEMPTS = Number(process.env.PACK_AFTER_ATTEMPTS || 2);
const START_DELAY_MS = 15 * 1000;

// with SCAN_DRY_RUN=1 no torrent is added and no search state is written. syncDownloads
// is not affected: it only mirrors back what the client already reports.
const isDryRun = () => process.env.SCAN_DRY_RUN === "1";

const log = (message: string) => console.log(`[scheduler]${ isDryRun() ? " [dry-run]" : "" } ${ message }`);

// syncDownloads writes in dry-run as well, so its lines must not claim otherwise
const syncLog = (message: string) => console.log(`[scheduler] ${ message }`);

const globalForScheduler = global as unknown as { schedulerStarted: boolean, schedulerRunning: boolean };

const dueFilter = () => {
    return {
        searchAttempts: { lt: MAX_ATTEMPTS },
        OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: new Date(Date.now() - BACKOFF_MS) } }
        ]
    };
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
export const syncDownloads = async () => {
    const torrents = await listManagedTorrents();
    const byHash = new Map(torrents.map(torrent => [ torrent.hash.toLowerCase(), torrent ]));

    const units = await prisma.watchlistUnit.findMany({
        where: { status: WatchStatus.DOWNLOADING, torrentHash: { not: null } },
        include: { watchlist: true }
    });

    const hashes = [ ...new Set(units.map(unit => String(unit.torrentHash).toLowerCase())) ];

    for (const hash of hashes) {
        const covered = units.filter(unit => String(unit.torrentHash).toLowerCase() === hash);
        const where = { id: { in: covered.map(unit => unit.id) } };
        const torrent = await resolveTorrent(byHash, hash);

        if (! torrent) {
            syncLog(`${ unitLabel(covered) }: torrent is gone from the client, queued for a new search`);

            await prisma.watchlistUnit.updateMany({
                where,
                data: { status: WatchStatus.PENDING, torrentHash: null }
            });

            continue;
        }

        if (torrent.isComplete) {
            syncLog(`${ unitLabel(covered) }: downloaded (${ torrent.name })`);

            await prisma.watchlistUnit.updateMany({ where, data: { status: WatchStatus.DOWNLOADED } });

        } else if (torrent.isFailed) {
            syncLog(`${ unitLabel(covered) }: torrent failed (${ torrent.state }), queued for a new search`);

            await prisma.watchlistUnit.updateMany({
                where,
                data: { status: WatchStatus.PENDING, torrentHash: null, searchAttempts: { increment: 1 } }
            });
        }
    }
};

export const scanMovies = async () => {
    const units = await prisma.watchlistUnit.findMany({
        where: {
            watchlist: { type: ContentType.MOVIE },
            status: { in: [ WatchStatus.PENDING, WatchStatus.SEARCHING ] },
            ...dueFilter()
        },
        include: { watchlist: true }
    });

    for (const unit of units) {
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

        log(`movie ${ tmdbId }: nothing suitable found (attempt ${ attempts }/${ MAX_ATTEMPTS })`);

        if (! isDryRun()) {
            await prisma.watchlistUnit.update({
                where: { id: unit.id },
                data: {
                    status: attempts >= MAX_ATTEMPTS ? WatchStatus.FAILED : WatchStatus.SEARCHING,
                    searchAttempts: attempts,
                    lastCheckedAt: new Date()
                }
            });
        }
    }
};

/**
 * Episodes are searched one by one first; a season pack is only grabbed once an
 * episode has failed PACK_AFTER_ATTEMPTS times on its own.
 */
export const scanEpisodes = async () => {
    const due = await prisma.watchlistUnit.findMany({
        where: {
            status: { in: [ WatchStatus.PENDING, WatchStatus.SEARCHING ] },
            airDate: { not: null, lte: new Date() },
            season: { monitored: true },
            ...dueFilter()
        },
        include: { watchlist: true, season: true }
    });

    const groups = new Map<string, { tmdbId: number, seasonNumber: number, units: typeof due }>();

    for (const unit of due) {
        if (! unit.season) {
            continue;
        }

        const key = `${ unit.watchlistId }:${ unit.season.seasonNumber }`;
        const group = groups.get(key) || {
            tmdbId: unit.watchlist.tmdbId,
            seasonNumber: unit.season.seasonNumber,
            units: []
        };

        group.units.push(unit);
        groups.set(key, group);
    }

    for (const { tmdbId, seasonNumber, units } of groups.values()) {
        const episodeNumbers = units.map(unit => unit.episodeNumber).filter((v): v is number => v !== null);

        const plan = await planSeasonGrab(tmdbId, seasonNumber, { episodeNumbers });

        if (! plan) {
            continue;
        }

        // a pack is only worth it once an episode could not be found on its own
        const usePack = !! plan.pack && units.some(unit => {
            const available = plan.episodes.find(v => v.episodeNumber === unit.episodeNumber)?.release;

            return ! available && unit.searchAttempts + 1 >= PACK_AFTER_ATTEMPTS;
        });

        const grabs = planGrabs(plan, episodeNumbers, usePack);

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

            log(`show ${ tmdbId } S${ seasonNumber }E${ unit.episodeNumber }: nothing found (attempt ${ attempts }/${ MAX_ATTEMPTS })`);

            if (! isDryRun()) {
                await prisma.watchlistUnit.update({
                    where: { id: unit.id },
                    data: {
                        status: attempts >= MAX_ATTEMPTS ? WatchStatus.FAILED : WatchStatus.SEARCHING,
                        searchAttempts: attempts,
                        lastCheckedAt: new Date()
                    }
                });
            }
        }
    }
};

/**
 * Picks up new seasons and air date changes. The TMDB cache keeps this cheap.
 */
export const refreshShows = async () => {
    const shows = await prisma.watchlist.findMany({
        where: { type: ContentType.TV, seasons: { some: { monitored: true } } }
    });

    for (const show of shows) {
        const seasons = await getTvSeasons(show.tmdbId);

        if (seasons.length === 0) {
            continue;
        }

        if (! isDryRun()) {
            await syncTvSeasons(show.id, show.tmdbId);
        }
    }
};

export const runScan = async () => {
    if (globalForScheduler.schedulerRunning) {
        log("previous run is still going, skipping this tick");

        return false;
    }

    globalForScheduler.schedulerRunning = true;

    try {
        await syncDownloads();
        await scanMovies();
        await scanEpisodes();
        await refreshShows();

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

    log(`started, scanning every ${ SCAN_INTERVAL_MS / 60000 } minutes`);

    setTimeout(() => void runScan(), START_DELAY_MS);
    setInterval(() => void runScan(), SCAN_INTERVAL_MS);
};
