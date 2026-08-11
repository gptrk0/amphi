import { ContentType, LibraryStatus, LogLevel, WatchStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { errorText, writeLog } from "@/lib/log";
import {
    audience,
    executeMovieGrab,
    executeSeasonGrab,
    grabContext,
    planMovieGrab,
    planSeasonGrab,
    planSeasonGrabs
} from "@/lib/grab";
import { languageProfileOf, searchLanguages } from "@/lib/language";
import {
    claimHeldUnits,
    forgetLibraryItem,
    hasLibraryItem,
    isSeeding,
    libraryLabel,
    markAvailable,
    restoreToWatchlist,
    runLibraryCleanup,
    setSize,
    syncSeedWindow
} from "@/lib/library";
import { getMediaMetadata, getTvSeasons, isTmdbConfigured, RECORD_LANGUAGE } from "@/lib/media";
import { isIndexerConfigured } from "@/lib/indexer";
import { normalizeTitle } from "@/lib/release";
import { BlockReason, blockRelease } from "@/lib/blocklist";
import { forgetStall, stallDeleteFiles, stallMinutes, trackStall } from "@/lib/stall";
import { inspectPayload, isPayloadCheckConfigured, payloadDeleteFiles } from "@/lib/payload";
import { loadSettings, settingFlag, settingNumber } from "@/lib/settings";
import { getTorrentFiles, getTorrentStatus, isClientConfigured, listManagedTorrents, removeTorrent, TorrentStatus } from "@/lib/torrent";
import { forWhom, isNotifyConfigured, nameList, notify, notifyUsers } from "@/lib/notify";
import { ensureMovieUnit, syncTvSeasons, toAirDate, toMediaType } from "@/lib/watchlist";

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
    syncRunning: boolean,
    // the timer is held so a round that just finished — scheduled or asked for by
    // hand — can push the next one a full interval away instead of letting the old
    // countdown run out minutes later
    scanTimer: ReturnType<typeof setTimeout> | null,
    nextScanAt: number | null
};

const scanTick = async () => {
    try {
        await runScan();

    } catch(err) {
        // never let one bad round end the loop
        console.error(err);

        await log("a scheduled tick failed, the loop carries on", LogLevel.ERROR, errorText(err));

        scheduleScan(scanIntervalMs());
    }
};

/** Every round ends by setting the next one, so there is only ever one timer. */
const scheduleScan = (delayMs: number) => {
    if (globalForScheduler.scanTimer) {
        clearTimeout(globalForScheduler.scanTimer);
    }

    globalForScheduler.nextScanAt = Date.now() + delayMs;
    globalForScheduler.scanTimer = setTimeout(scanTick, delayMs);
};

/**
 * When the next round is due, so the page can count down to it instead of the user
 * guessing. Null until the scheduler has started — or when it never will, because
 * `SCAN_DISABLED` is set.
 */
export const nextScanAt = () => globalForScheduler.nextScanAt || null;

export const isScanRunning = () => !! globalForScheduler.schedulerRunning;

/**
 * The wait doubles with every fruitless search up to a cap, and nothing is ever
 * given up on: a release that is not out yet may show up in a month, so a hard
 * attempt limit would quietly stop watching exactly the titles that need watching.
 */
const backoffMs = (attempts: number) => Math.min(backoffBaseMs() * 2 ** attempts, maxBackoffMs());

const waitText = (ms: number) => ms < 60 * 60 * 1000 ? `${ Math.round(ms / 60000) }m` : `${ Math.round(ms / 3600000) }h`;

// what this search would accept. Almost always one language, so the common line reads
// exactly as it did before — and when it is more, the log is where you find out why a
// show came down in English
const languageText = (context: { languages: string[] }) => context.languages.join("/");

// the log says when the seed lock lifts, because that is the only thing standing
// between a finished download and the delete button. Both halves are worth printing: how
// much is owed, and how much the client says has already been served
const seedLeftText = (item: { seedUntil: Date | null }, seedingTimeSeconds: number) => {
    const served = Math.round(seedingTimeSeconds / 3600);
    const left = item.seedUntil ? Math.round((item.seedUntil.getTime() - Date.now()) / 3600000) : 0;

    return `${ left }h to go, ${ served }h seeded so far as the client counts it`;
};

const seedUntilText = (item: { seedUntil: Date | null }, seedingTimeSeconds: number) => {
    const days = settingNumber("LIBRARY_SEED_DAYS");

    if (days <= 0) {
        return "no seed time is set, it can be deleted at once";
    }

    return item.seedUntil && item.seedUntil.getTime() > Date.now()
        ? `seeding for ${ days } day${ days === 1 ? "" : "s" }, ${ seedLeftText(item, seedingTimeSeconds) }`
        : `its ${ days } day${ days === 1 ? "" : "s" } of seeding were already served, it can be deleted`;
};

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
 * A title instead of a tmdb id, for a line a person reads. The metadata is cached.
 *
 * In the record language, not the reader's: this ends up in the log and in notifications,
 * and a scan started from the admin page would otherwise write its lines in whatever
 * language that admin happens to browse in. Half a log in Hungarian is not a log.
 */
const titleOf = async (type: ContentType, tmdbId: number) => {
    const metadata = await getMediaMetadata(toMediaType(type), tmdbId, RECORD_LANGUAGE);

    return metadata ? metadata.media.name : `TMDB #${ tmdbId }`;
};

/**
 * A grab the scanner made: the install chat hears about it because it hears about
 * everything, and the people whose lists it came off hear about it because it is
 * theirs.
 */
const notifyStarted = async (
    type: ContentType,
    tmdbId: number,
    releaseTitle: string,
    started?: { label: string, watchedBy: number[] }
) => {
    const name = await titleOf(type, tmdbId);

    // a film has no label worth printing — "Mortal Kombat II movie" reads like a typo
    const full = started?.label ? `${ name } ${ started.label }` : name;
    const watchedBy = started ? started.watchedBy : [];

    await notify("started", full, releaseTitle, await forWhom(watchedBy));
    await notifyUsers(watchedBy, "started", full, releaseTitle);
};

/**
 * Reads download state back from qBittorrent. One library row is one torrent, so
 * this is a plain loop now — the episodes of a season pack are one row and finish
 * together by construction.
 *
 * This runs in dry-run too: it starts nothing, it only records what the client
 * already did, and hiding that would leave a finished download stuck on its bar.
 */
export const syncDownloads = async (preloaded?: TorrentStatus[]) => {
    const torrents = preloaded || await listManagedTorrents();
    const byHash = new Map(torrents.map(torrent => [ torrent.hash.toLowerCase(), torrent ]));

    const items = await prisma.library.findMany({
        where: { removedAt: null, torrentHash: { not: null } },
    });

    for (const item of items) {
        const hash = String(item.torrentHash).toLowerCase();
        const label = await libraryLabel(item);
        const torrent = await resolveTorrent(byHash, hash);

        if (! torrent) {
            // the same disappearance means two different things: a download that
            // never finished was cancelled or failed and is worth another search,
            // while a finished one was watched and cleaned up
            if (item.status === LibraryStatus.AVAILABLE) {
                await syncLog(`${ label }: removed from the client after finishing, treated as watched and deleted`);

                await forgetLibraryItem(item);

            } else {
                await syncLog(`${ label }: torrent is gone from the client, queued for a new search`, LogLevel.WARN);

                await restoreToWatchlist(item);
            }

            continue;
        }

        if (item.status === LibraryStatus.AVAILABLE) {
            // rows that came from the old model have no release name: it was never
            // stored on a unit, and the client is the only place it still exists
            if (! item.releaseTitle) {
                await prisma.library.update({ where: { id: item.id }, data: { releaseTitle: torrent.name } });
            }

            // and rows that finished before the size was stored. One write each, once:
            // this is the last chance, because the torrent is what knows it
            if (! item.sizeBytes && torrent.size > 0) {
                await setSize(item.id, torrent.size);
            }

            // the seed window follows the client's own seeding time rather than a date
            // set once when the download landed — a paused torrent owes the time it is
            // not spending, and one that seeded before the app noticed is not asked twice
            const moved = await syncSeedWindow(item, torrent.seedingTime);

            if (moved) {
                await syncLog(
                    `${ label }: seed time ${ isSeeding(moved) ? `is not up yet, ${ seedLeftText(moved, torrent.seedingTime) }` : "is up, it can be deleted" }`,
                    LogLevel.DEBUG
                );
            }

            continue;
        }

        // Before anything is called finished: the name was all the indexer offered,
        // and a fake copies it exactly. This is the first look at what is actually
        // in there, and it runs while the download is still going, so a bad one is
        // dropped instead of being handed over as available.
        const payload = inspectPayload(await getTorrentFiles(hash));

        if (payload.bad) {
            await syncLog(`${ label }: ${ payload.reason } (${ torrent.name }), not the release it claims to be — dropping it`, LogLevel.WARN);

            if (isDryRun()) {
                await log("a bad payload is left alone in dry-run, the torrent stays");

                continue;
            }

            await blockRelease(normalizeTitle(torrent.name), BlockReason.BAD_PAYLOAD, payload.reason);
            await notify("dropped", label, `${ payload.reason } — ${ torrent.name }`, await forWhom(item.watchedBy));
            await notifyUsers(item.watchedBy, "dropped", label, `${ payload.reason } — ${ torrent.name }`);

            await removeTorrent(hash, payloadDeleteFiles());
            forgetStall(hash);

            await restoreToWatchlist(item);

            continue;
        }

        if (torrent.isComplete) {
            const available = await markAvailable(item.id, torrent.name, torrent.size, torrent.seedingTime);

            await syncLog(`${ label }: downloaded (${ torrent.name }), ${ seedUntilText(available, torrent.seedingTime) }`);

            await notify("ready", label, torrent.name, await forWhom(item.watchedBy));
            await notifyUsers(item.watchedBy, "ready", label, torrent.name);

        } else if (torrent.isFailed) {
            await syncLog(`${ label }: torrent failed (${ torrent.state }), queued for a new search`, LogLevel.WARN);

            await restoreToWatchlist(item);

        } else if (trackStall(torrent)) {
            // nothing has arrived for the whole threshold: the release is dead, not
            // slow. it goes with its files, is remembered so the next search does
            // not pick it again, and what it covered is due immediately
            await syncLog(`${ label }: stalled at ${ Math.round(torrent.progress * 100) }% for ${ stallMinutes() } minutes (${ torrent.state }), dropping it for another release`, LogLevel.WARN);

            if (isDryRun()) {
                await log("stall handling is skipped in dry-run, the torrent stays");

                continue;
            }

            const stalled = `stood still at ${ Math.round(torrent.progress * 100) }% for ${ stallMinutes() } minutes`;

            await blockRelease(normalizeTitle(torrent.name), BlockReason.STALLED, stalled);
            await notify("dropped", label, `${ stalled } — ${ torrent.name }`, await forWhom(item.watchedBy));
            await notifyUsers(item.watchedBy, "dropped", label, `${ stalled } — ${ torrent.name }`);

            await removeTorrent(hash, stallDeleteFiles());
            forgetStall(hash);

            await restoreToWatchlist(item);
        }
    }

    // what the app deleted by itself this round: a mark left while it was still seeding,
    // and a retention time that ran out. The second one destroys files nobody asked about
    // just now, so it is a WARN and it says who to blame — the setting, not a person
    for (const { item, why } of await runLibraryCleanup()) {
        const label = await libraryLabel(item);
        const withFiles = why === "expired" || item.deleteFiles;
        const marked = item.deleteRequestedBy ? await nameList([ item.deleteRequestedBy ]) : "";

        const who = why === "expired"
            ? `nobody — it was kept for ${ settingNumber("LIBRARY_RETENTION_DAYS") } days and the time ran out`
            : marked ? `marked for deletion by ${ marked }` : "marked for deletion earlier";

        await syncLog(
            `${ label }: ${ why === "expired" ? "the retention time ran out" : "the seed time is up and it was marked for deletion" }, ${ withFiles ? "removed with its files" : "removed, the files were kept" }`,
            why === "expired" ? LogLevel.WARN : LogLevel.INFO
        );

        await notify("deleted", label, item.releaseTitle || undefined, who);
        await notifyUsers(item.watchedBy, "deleted", label, item.releaseTitle || undefined);
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

    // Three people wanting the same film is three units, and it is one film to look
    // for **per language**. Grouping is not an optimisation — searching an indexer
    // three times for the same thing is how an account gets rate limited — but two
    // people who want it in different languages are two searches, because to them it
    // is two different files.
    const groups = new Map<string, { languages: string[], units: typeof due }>();

    for (const unit of due) {
        // the row's own answer first, then the account's — see `searchLanguages`
        const languages = searchLanguages(await languageProfileOf(unit.watchlist.userId), unit.watchlist.language);
        const key = `${ unit.watchlist.tmdbId }:${ languages.join(",") }`;

        const group = groups.get(key) || { languages, units: [] };

        group.units.push(unit);
        groups.set(key, group);
    }

    for (const [ , { languages, units: wanted } ] of groups) {
        const tmdbId = wanted[0].watchlist.tmdbId;
        const userIds = [ ...new Set(wanted.map(unit => unit.watchlist.userId)) ];
        const context = await grabContext(userIds, { strict: true, languages });
        // The episode side asks this through `heldEpisodes`; a film has no episodes,
        // so it needs its own look. Without it a film that is already in the library
        // — put back on the watchlist by a failed grab, say — is fetched all over
        // again, in whatever release the profile likes this time.
        if (await hasLibraryItem(tmdbId, audience(context))) {
            // and it answers these people too, so their units go with it rather than
            // waiting for a download that has already happened
            const claimed = isDryRun() ? 0 : await claimHeldUnits(tmdbId, ContentType.MOVIE, audience(context));

            await log(
                `movie ${ tmdbId }: already in the library in ${ languageText(context) }, not searched for`,
                claimed > 0 ? LogLevel.INFO : LogLevel.DEBUG,
                claimed > 0 ? `${ claimed } waiting list${ claimed > 1 ? "s" : "" } taken off it` : undefined
            );

            continue;
        }

        const plan = await planMovieGrab(tmdbId, context);

        if (plan?.release) {
            await log(`movie ${ tmdbId } (${ languageText(context) }): grabbing ${ plan.release.title }${ wanted.length > 1 ? ` (${ wanted.length } people are waiting for it)` : "" }`);

            grabbed++;

            if (! isDryRun()) {
                const started = await executeMovieGrab(tmdbId, plan.release, context);

                if (! started) {
                    // the grab put itself back on the watchlist, so nothing is lost —
                    // but a client that will not take a release is worth saying out loud
                    await log(`movie ${ tmdbId }: the torrent client did not take the release`, LogLevel.WARN);

                    continue;
                }

                await notifyStarted(ContentType.MOVIE, tmdbId, plan.release.title, { label: "", watchedBy: started.watchedBy });
            }

            continue;
        }

        // the backoff is the film's, not one person's: whoever asked last does not get
        // to reset the clock for everybody else who wants it in the same language
        const attempts = Math.max(...wanted.map(unit => unit.searchAttempts)) + 1;

        await log(`movie ${ tmdbId }: nothing suitable found in ${ languageText(context) } (attempt ${ attempts }, next in ${ waitText(backoffMs(attempts)) })`);

        if (! isDryRun()) {
            await prisma.watchlistUnit.updateMany({
                where: { id: { in: wanted.map(unit => unit.id) } },
                data: {
                    status: WatchStatus.SEARCHING,
                    searchAttempts: attempts,
                    lastCheckedAt: new Date()
                }
            });
        }
    }

    // what the round summary is made of: how much was looked at, how much came of it.
    // Searches, not rows — the same film on four lists is one look.
    return { looked: groups.size, grabbed };
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

    // by the show, the season and the language: the same season on four lists is one
    // season to search for and one pack to decide about — unless two of those lists
    // want it in different languages, and then it is two of everything
    const groups = new Map<string, { tmdbId: number, seasonNumber: number, languages: string[], units: typeof due }>();

    for (const unit of due) {
        if (unit.seasonNumber === null) {
            continue;
        }

        const languages = searchLanguages(await languageProfileOf(unit.watchlist.userId), unit.watchlist.language);
        const key = `${ unit.watchlist.tmdbId }:${ unit.seasonNumber }:${ languages.join(",") }`;

        const group = groups.get(key) || {
            tmdbId: unit.watchlist.tmdbId,
            seasonNumber: unit.seasonNumber,
            languages,
            units: []
        };

        group.units.push(unit);
        groups.set(key, group);
    }

    let lookedAt = 0;

    for (const { tmdbId, seasonNumber, languages, units } of groups.values()) {
        const episodeNumbers = [ ...new Set(units
            .map(unit => unit.episodeNumber)
            .filter((v): v is number => v !== null)) ];

        lookedAt += episodeNumbers.length;

        const userIds = [ ...new Set(units.map(unit => unit.watchlist.userId)) ];
        const context = await grabContext(userIds, { strict: true, languages });

        // episodes somebody else already fetched in this same language are not searched
        // for again, so the units waiting for them have to be taken by that download
        // rather than left waiting for one that will never come
        if (! isDryRun()) {
            const claimed = await claimHeldUnits(tmdbId, ContentType.TV, audience(context));

            if (claimed > 0) {
                await log(`show ${ tmdbId } S${ seasonNumber }: ${ claimed } episode${ claimed > 1 ? "s were" : " was" } already downloaded in ${ languageText(context) }, taken off the watchlist`);
            }
        }

        const plan = await planSeasonGrab(tmdbId, seasonNumber, context, { episodeNumbers });

        if (! plan) {
            continue;
        }

        const { usePack, grabs } = await planSeasonGrabs(tmdbId, plan, context, { episodeNumbers });

        for (const grab of grabs) {
            await log(`show ${ tmdbId } S${ seasonNumber } ${ grab.isPack ? "pack" : `E${ grab.episodeNumbers.join(",E") }` } (${ languageText(context) }): grabbing ${ grab.release.title }`);
        }

        grabCount += grabs.length;

        if (! isDryRun() && grabs.length > 0) {
            for (const started of await executeSeasonGrab(tmdbId, plan, context, { episodeNumbers, usePack })) {
                await notifyStarted(ContentType.TV, tmdbId, started.title, started);
            }
        }

        const grabbed = new Set(grabs.flatMap(grab => grab.episodeNumbers));

        // one line and one write per episode, however many lists it sits on
        const missed = new Map<number, typeof units>();

        for (const unit of units) {
            if (unit.episodeNumber === null || grabbed.has(unit.episodeNumber)) {
                continue;
            }

            missed.set(unit.episodeNumber, [ ...(missed.get(unit.episodeNumber) || []), unit ]);
        }

        for (const [ episodeNumber, waiting ] of missed) {
            const attempts = Math.max(...waiting.map(unit => unit.searchAttempts)) + 1;

            await log(`show ${ tmdbId } S${ seasonNumber }E${ episodeNumber }: nothing found in ${ languageText(context) } (attempt ${ attempts }, next in ${ waitText(backoffMs(attempts)) })`);

            if (! isDryRun()) {
                await prisma.watchlistUnit.updateMany({
                    where: { id: { in: waiting.map(unit => unit.id) } },
                    data: {
                        status: WatchStatus.SEARCHING,
                        searchAttempts: attempts,
                        lastCheckedAt: new Date()
                    }
                });
            }
        }
    }

    return { looked: lookedAt, grabbed: grabCount };
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

        // a manual round counts as a round: the wait starts again from here, which is
        // also what the countdown next to the button shows
        if (globalForScheduler.scanTimer) {
            scheduleScan(scanIntervalMs());
        }
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

    // the one timer in the app that destroys files, so it says so on every boot rather
    // than only in the settings page nobody opens twice
    const retentionDays = settingNumber("LIBRARY_RETENTION_DAYS");

    await log(retentionDays > 0
        ? `a finished download is deleted with its files ${ retentionDays } days after it lands (Settings / Library)`
        : "nothing in the library is deleted on its own: it stays until somebody deletes it (Settings / Library)");

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

    // the scan has its own scheduler rather than this loop, because every round —
    // including a manual one — restarts its clock
    scheduleScan(START_DELAY_MS);

    loop(() => syncDownloadsOnce(), syncIntervalMs, syncIntervalMs());
};
