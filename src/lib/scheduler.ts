import { ContentType, LogLevel, WatchStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { errorText, writeLog } from "@/lib/log";
import { executeMovieGrab, executeSeasonGrab, planMovieGrab, planSeasonGrab, planSeasonGrabs } from "@/lib/grab";
import { getMediaMetadata, getTvSeasons, isTmdbConfigured } from "@/lib/media";
import { isIndexerConfigured } from "@/lib/indexer";
import { normalizeTitle } from "@/lib/release";
import { BlockReason, blockRelease } from "@/lib/blocklist";
import { forgetStall, stallDeleteFiles, stallMinutes, trackStall } from "@/lib/stall";
import { inspectPayload, isPayloadCheckConfigured, payloadDeleteFiles } from "@/lib/payload";
import { loadSettings, settingFlag, settingNumber } from "@/lib/settings";
import { getTorrentFiles, getTorrentStatus, isClientConfigured, listManagedTorrents, removeTorrent, TorrentStatus } from "@/lib/torrent";
import { isNotifyConfigured, notify } from "@/lib/notify";
import {
    ensureMovieUnit,
    forgetUnits,
    markUnitsDownloading,
    pruneWatchlistItem,
    syncTvSeasons,
    toAirDate,
    toMediaType
} from "@/lib/watchlist";

const scanIntervalMs = () => settingNumber("WATCHLIST_SCAN_INTERVAL_MINUTES") * 60 * 1000;

// Reading the client's state back is one local request, while a scan round is
// dozens of indexer calls — so noticing that something finished does not have to
// wait for the next round.
const syncIntervalMs = () => settingNumber("DOWNLOAD_SYNC_INTERVAL_MINUTES") * 60 * 1000;
const backoffBaseMs = () => settingNumber("SEARCH_BACKOFF_MINUTES") * 60 * 1000;
const maxBackoffMs = () => settingNumber("SEARCH_MAX_BACKOFF_HOURS") * 60 * 60 * 1000;
const START_DELAY_MS = 15 * 1000;

// with SCAN_DRY_RUN=1 no torrent is added and no search state is written. syncDownloads
// is not affected: it only mirrors back what the client already reports.
const isDryRun = () => settingFlag("SCAN_DRY_RUN");

// `writeLog` prints to the console and stores the line, so the admin page and
// `docker logs` can never end up telling different stories
const log = (message: string, level: LogLevel = LogLevel.INFO, detail?: string) => {
    return writeLog(level, "scheduler", `${ isDryRun() ? "[dry-run] " : "" }${ message }`, detail);
};

// syncDownloads writes in dry-run as well, so its lines must not claim otherwise
const syncLog = (message: string, level: LogLevel = LogLevel.INFO, detail?: string) => {
    return writeLog(level, "scheduler", message, detail);
};

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
const backoffMs = (attempts: number) => Math.min(backoffBaseMs() * 2 ** attempts, maxBackoffMs());

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
            { lastCheckedAt: { lt: new Date(Date.now() - backoffBaseMs()) } }
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
        await syncLog(`torrent ${ hash.slice(0, 8) } is outside the managed category`);
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

const code = (value: number | null) => String(value ?? 0).padStart(2, "0");

// structural on purpose, like unitLabel above: only what the label needs
type UnitWithItem = {
    seasonNumber: number | null;
    episodeNumber: number | null;
    watchlist: { tmdbId: number, type: ContentType };
};

/**
 * The same thing as `unitLabel` but for a person: a title instead of a tmdb id. The
 * metadata is cached, so this costs nothing on the usual path.
 */
const readableLabel = async (units: UnitWithItem[]) => {
    const item = units[0].watchlist;
    const metadata = await getMediaMetadata(toMediaType(item.type), item.tmdbId);
    const name = metadata ? metadata.media.name : `TMDB #${ item.tmdbId }`;
    const episodes = units.filter(unit => unit.episodeNumber !== null);

    if (episodes.length === 0) {
        return name;
    }

    if (episodes.length === 1) {
        return `${ name } S${ code(episodes[0].seasonNumber) }E${ code(episodes[0].episodeNumber) }`;
    }

    const seasons = [ ...new Set(episodes.map(unit => unit.seasonNumber)) ];
    const where = seasons.length === 1 ? ` S${ code(seasons[0]) }` : "";

    return `${ name }${ where } — ${ episodes.length } episodes`;
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
                await syncLog(`${ unitLabel(done) }: removed from the client after finishing, treated as watched and deleted`);

                await forgetUnits(done.map(unit => unit.id));
                await pruneWatchlistItem(done[0].watchlistId);
            }

            if (running.length > 0) {
                await syncLog(`${ unitLabel(running) }: torrent is gone from the client, queued for a new search`, LogLevel.WARN);

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

        // Before anything is called finished: the name was all the indexer offered,
        // and a fake copies it exactly. This is the first look at what is actually
        // in there, and it runs while the download is still going, so a bad one is
        // dropped instead of being handed over as available.
        const payload = inspectPayload(await getTorrentFiles(hash));

        if (payload.bad) {
            await syncLog(`${ unitLabel(running) }: ${ payload.reason } (${ torrent.name }), not the release it claims to be — dropping it`, LogLevel.WARN);

            if (isDryRun()) {
                await log("a bad payload is left alone in dry-run, the torrent stays");

                continue;
            }

            await blockRelease(normalizeTitle(torrent.name), BlockReason.BAD_PAYLOAD, payload.reason);
            await notify("dropped", await readableLabel(running), `${ payload.reason } — ${ torrent.name }`);

            await removeTorrent(hash, payloadDeleteFiles());
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

            continue;
        }

        if (torrent.isComplete) {
            await syncLog(`${ unitLabel(running) }: downloaded (${ torrent.name })`);

            // A finished film is off the watchlist the moment it lands — there is
            // never anything left to watch for. An episode keeps the flag: it is the
            // only record that its season was wanted, and `inheritedMonitored` reads
            // it to decide whether a later episode or season is followed.
            const isMovie = running.every(unit => unit.seasonNumber === null);

            await prisma.watchlistUnit.updateMany({
                where,
                data: {
                    status: WatchStatus.DOWNLOADED,
                    ...(isMovie ? { monitored: false } : {})
                }
            });

            await notify("ready", await readableLabel(running), torrent.name);

        } else if (torrent.isFailed) {
            await syncLog(`${ unitLabel(running) }: torrent failed (${ torrent.state }), queued for a new search`, LogLevel.WARN);

            await prisma.watchlistUnit.updateMany({
                where,
                data: { status: WatchStatus.PENDING, torrentHash: null, searchAttempts: { increment: 1 } }
            });

        } else if (trackStall(torrent)) {
            // nothing has arrived for the whole threshold: the release is dead, not
            // slow. it goes with its files, is remembered so the next search does
            // not pick it again, and the units are due immediately
            await syncLog(`${ unitLabel(running) }: stalled at ${ Math.round(torrent.progress * 100) }% for ${ stallMinutes() } minutes (${ torrent.state }), dropping it for another release`, LogLevel.WARN);

            if (isDryRun()) {
                await log("stall handling is skipped in dry-run, the torrent stays");

                continue;
            }

            const stalled = `stood still at ${ Math.round(torrent.progress * 100) }% for ${ stallMinutes() } minutes`;

            await blockRelease(normalizeTitle(torrent.name), BlockReason.STALLED, stalled);
            await notify("dropped", await readableLabel(running), `${ stalled } — ${ torrent.name }`);

            await removeTorrent(hash, stallDeleteFiles());
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
 * now, whether or not its backoff has elapsed.
 *
 * It does *not* reach past the release dates, and nothing else may either. Something
 * that is not out yet cannot be on a tracker, so a release that matches it is a fake
 * by definition — and its name can be a perfect copy of the real one, which is how a
 * padded `.scr` was grabbed as an unaired Silo episode on 2026-08-08. The date is the
 * only check that catches that, so it is not optional.
 */
export type ScanOptions = { force?: boolean };

export const scanMovies = async (options: ScanOptions = {}) => {
    const units = await prisma.watchlistUnit.findMany({
        where: {
            watchlist: { type: ContentType.MOVIE },
            monitored: true,
            status: { in: [ WatchStatus.PENDING, WatchStatus.SEARCHING ] },
            // an unknown date does not hold a film back, a future one does. Episodes
            // are held back by the same airDate, just in scanEpisodes
            AND: [ { OR: [ { airDate: null }, { airDate: { lte: new Date() } } ] } ],
            ...(options.force ? {} : dueFilter())
        },
        include: { watchlist: true }
    });

    const due = options.force ? units : units.filter(isDue);
    let grabbed = 0;

    for (const unit of due) {
        const tmdbId = unit.watchlist.tmdbId;
        const plan = await planMovieGrab(tmdbId);

        if (plan?.release) {
            await log(`movie ${ tmdbId }: grabbing ${ plan.release.title }`);

            grabbed++;

            if (! isDryRun()) {
                const started = await executeMovieGrab(tmdbId, plan.release);

                if (! started) {
                    // the release was picked but the client did not take it, and the unit
                    // is marked downloading with no hash — worth saying out loud
                    await log(`movie ${ tmdbId }: the torrent client did not take the release`, LogLevel.WARN);

                    await markUnitsDownloading([ unit.id ], null);
                }

                await notify("started", await readableLabel([ unit ]), plan.release.title);
            }

            continue;
        }

        const attempts = unit.searchAttempts + 1;

        await log(`movie ${ tmdbId }: nothing suitable found (attempt ${ attempts }, next in ${ waitText(backoffMs(attempts)) })`);

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

    // what the round summary is made of: how much was looked at, how much came of it
    return { looked: due.length, grabbed };
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
            // an episode with no date at all is not searched for either: a show's
            // unaired episodes are exactly what fake releases are named after
            airDate: { not: null, lte: new Date() },
            ...(options.force ? {} : dueFilter())
        },
        include: { watchlist: true }
    });

    const due = options.force ? found : found.filter(isDue);
    let grabCount = 0;

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

        const plan = await planSeasonGrab(tmdbId, seasonNumber, { episodeNumbers });

        if (! plan) {
            continue;
        }

        const { usePack, grabs } = await planSeasonGrabs(watchlistId, plan, { episodeNumbers });

        for (const grab of grabs) {
            await log(`show ${ tmdbId } S${ seasonNumber } ${ grab.isPack ? "pack" : `E${ grab.episodeNumbers.join(",E") }` }: grabbing ${ grab.release.title }`);
        }

        grabCount += grabs.length;

        if (! isDryRun() && grabs.length > 0) {
            await executeSeasonGrab(tmdbId, plan, { episodeNumbers, usePack });

            for (const grab of grabs) {
                const covered = units.filter(unit => unit.episodeNumber !== null
                    && grab.episodeNumbers.includes(unit.episodeNumber));

                await notify("started", await readableLabel(covered.length > 0 ? covered : units), grab.release.title);
            }
        }

        const grabbed = new Set(grabs.flatMap(grab => grab.episodeNumbers));

        for (const unit of units) {
            if (unit.episodeNumber === null || grabbed.has(unit.episodeNumber)) {
                continue;
            }

            const attempts = unit.searchAttempts + 1;

            await log(`show ${ tmdbId } S${ seasonNumber }E${ unit.episodeNumber }: nothing found (attempt ${ attempts }, next in ${ waitText(backoffMs(attempts)) })`);

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

    return { looked: due.length, grabbed: grabCount };
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

    // reading the client back once a minute with no client to read is not an error worth
    // logging sixty times an hour — `startScheduler` says it once instead
    if (! isClientConfigured()) {
        return false;
    }

    globalForScheduler.syncRunning = true;

    try {
        await syncDownloads(preloaded);

    } catch(err) {
        // the console keeps the stack, the log keeps the line
        console.error(err);

        await syncLog("reading the downloads back failed", LogLevel.ERROR, errorText(err));

    } finally {
        globalForScheduler.syncRunning = false;
    }

    return true;
};

export const runScan = async (options: ScanOptions = {}) => {
    if (globalForScheduler.schedulerRunning) {
        await log("previous run is still going, skipping this tick");

        return false;
    }

    globalForScheduler.schedulerRunning = true;

    if (options.force) {
        await log("manual scan: every monitored item that is out, backoff ignored");
    }

    const startedAt = Date.now();

    try {
        // the settings are read synchronously from here on, so the round starts by
        // pulling in whatever the admin page changed since the last one
        await loadSettings();

        await syncDownloadsOnce();
        await refreshMetadata();

        const movies = await scanMovies(options);
        const episodes = await scanEpisodes(options);

        const looked = movies.looked + episodes.looked;
        const grabbed = movies.grabbed + episodes.grabbed;

        // a round that had nothing to do is the normal case every fifteen minutes, and
        // ninety-six of those a day would bury the lines that matter — so that one is
        // only kept when debug entries are asked for
        await log(
            `round finished in ${ Math.round((Date.now() - startedAt) / 1000) }s: ${ looked } searched, ${ grabbed } grabbed`,
            looked > 0 ? LogLevel.INFO : LogLevel.DEBUG
        );

    } catch(err) {
        console.error(err);

        await log("the scan round failed", LogLevel.ERROR, errorText(err));

    } finally {
        globalForScheduler.schedulerRunning = false;
    }

    return true;
};

export const startScheduler = async () => {
    if (globalForScheduler.schedulerStarted) {
        return;
    }

    globalForScheduler.schedulerStarted = true;

    // every setting below is read synchronously, so the table has to be in memory
    // before the first line is logged
    await loadSettings(true);

    await log(`started, scanning every ${ scanIntervalMs() / 60000 } minutes, reading the client back every ${ syncIntervalMs() / 60000 }`);

    // a list can be empty, and a check that cannot reject anything must not look like
    // it is guarding something
    // a fresh install has none of these, and a scanner that searches nothing every
    // fifteen minutes looks like it is working
    if (! isTmdbConfigured()) {
        await log("TMDB is not configured: nothing can be listed or searched until the api key is in (Settings / TMDB)", LogLevel.WARN);
    }

    if (! isIndexerConfigured()) {
        await log("no indexer is configured: every search comes back empty (Settings / Indexers)", LogLevel.WARN);
    }

    if (! isClientConfigured()) {
        await log("the torrent client is not configured: nothing can be downloaded (Settings / Torrent client)", LogLevel.WARN);
    }

    if (! isPayloadCheckConfigured()) {
        await log("payload check is OFF: fill in the extension lists under Settings / Content check", LogLevel.WARN);
    }

    if (isNotifyConfigured()) {
        await log("telegram notifications are on");

    } else {
        await log("telegram notifications are OFF: fill in the token, the chat id and the events under Settings / Notifications", LogLevel.WARN);
    }

    /**
     * Reschedules itself instead of using setInterval, because the interval is a
     * setting: `setInterval` would freeze whatever it was at boot, and changing it on
     * the admin page would need a restart to matter.
     */
    const loop = (run: () => Promise<unknown>, everyMs: () => number, firstDelay: number) => {
        const tick = async () => {
            try {
                await run();

            } catch(err) {
                // never let one bad round end the loop
                console.error(err);

                await log("a scheduled tick failed, the loop carries on", LogLevel.ERROR, errorText(err));
            }

            setTimeout(tick, everyMs());
        };

        setTimeout(tick, firstDelay);
    };

    loop(() => runScan(), scanIntervalMs, START_DELAY_MS);
    loop(() => syncDownloadsOnce(), syncIntervalMs, syncIntervalMs());
};
