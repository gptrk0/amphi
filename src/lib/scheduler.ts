import { ContentType, WatchStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { executeMovieGrab, executeSeasonGrab, planGrabs, planMovieGrab, planSeasonGrab } from "@/lib/grab";
import { getTvSeasons } from "@/lib/media";
import { listManagedTorrents } from "@/lib/torrent";
import { markMovieDownloading, syncTvSeasons } from "@/lib/watchlist";

const SCAN_INTERVAL_MS = Number(process.env.WATCHLIST_SCAN_INTERVAL_MINUTES || 15) * 60 * 1000;
const BACKOFF_MS = Number(process.env.SEARCH_BACKOFF_MINUTES || 30) * 60 * 1000;
const MAX_ATTEMPTS = Number(process.env.MAX_SEARCH_ATTEMPTS || 10);
const PACK_AFTER_ATTEMPTS = Number(process.env.PACK_AFTER_ATTEMPTS || 2);
const START_DELAY_MS = 15 * 1000;

// with SCAN_DRY_RUN=1 nothing is added to the torrent client and no state is written
const isDryRun = () => process.env.SCAN_DRY_RUN === "1";

const log = (message: string) => console.log(`[scheduler]${ isDryRun() ? " [dry-run]" : "" } ${ message }`);

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
 * Reads download state back from qBittorrent. Episodes of a season pack share one
 * hash, so a single finished torrent completes all of them at once.
 */
export const syncDownloads = async () => {
    const torrents = await listManagedTorrents();
    const byHash = new Map(torrents.map(torrent => [ torrent.hash.toLowerCase(), torrent ]));

    const movies = await prisma.watchlist.findMany({
        where: { type: ContentType.MOVIE, status: WatchStatus.DOWNLOADING, torrentHash: { not: null } }
    });

    const episodes = await prisma.watchlistEpisode.findMany({
        where: { status: WatchStatus.DOWNLOADING, torrentHash: { not: null } }
    });

    for (const movie of movies) {
        const torrent = byHash.get(String(movie.torrentHash).toLowerCase());

        if (! torrent) {
            log(`movie ${ movie.tmdbId }: torrent is gone from the client, queued for a new search`);

            if (! isDryRun()) {
                await prisma.watchlist.update({
                    where: { id: movie.id },
                    data: { status: WatchStatus.PENDING, torrentHash: null }
                });
            }

            continue;
        }

        if (torrent.isComplete) {
            log(`movie ${ movie.tmdbId }: downloaded (${ torrent.name })`);

            if (! isDryRun()) {
                await prisma.watchlist.update({ where: { id: movie.id }, data: { status: WatchStatus.DOWNLOADED } });
            }

        } else if (torrent.isFailed) {
            log(`movie ${ movie.tmdbId }: torrent failed (${ torrent.state }), queued for a new search`);

            if (! isDryRun()) {
                await prisma.watchlist.update({
                    where: { id: movie.id },
                    data: { status: WatchStatus.PENDING, torrentHash: null, searchAttempts: { increment: 1 } }
                });
            }
        }
    }

    const hashes = [ ...new Set(episodes.map(episode => String(episode.torrentHash).toLowerCase())) ];

    for (const hash of hashes) {
        const torrent = byHash.get(hash);
        const count = episodes.filter(episode => String(episode.torrentHash).toLowerCase() === hash).length;

        if (! torrent) {
            log(`${ count } episode(s): torrent is gone from the client, queued for a new search`);

            if (! isDryRun()) {
                await prisma.watchlistEpisode.updateMany({
                    where: { torrentHash: { in: [ hash ] }, status: WatchStatus.DOWNLOADING },
                    data: { status: WatchStatus.PENDING, torrentHash: null }
                });
            }

            continue;
        }

        if (torrent.isComplete) {
            log(`${ count } episode(s) downloaded (${ torrent.name })`);

            if (! isDryRun()) {
                await prisma.watchlistEpisode.updateMany({
                    where: { torrentHash: { in: [ hash ] }, status: WatchStatus.DOWNLOADING },
                    data: { status: WatchStatus.DOWNLOADED }
                });
            }

        } else if (torrent.isFailed) {
            log(`${ count } episode(s): torrent failed (${ torrent.state }), queued for a new search`);

            if (! isDryRun()) {
                await prisma.watchlistEpisode.updateMany({
                    where: { torrentHash: { in: [ hash ] }, status: WatchStatus.DOWNLOADING },
                    data: { status: WatchStatus.PENDING, torrentHash: null, searchAttempts: { increment: 1 } }
                });
            }
        }
    }
};

export const scanMovies = async () => {
    const movies = await prisma.watchlist.findMany({
        where: {
            type: ContentType.MOVIE,
            status: { in: [ WatchStatus.PENDING, WatchStatus.SEARCHING ] },
            ...dueFilter()
        }
    });

    for (const movie of movies) {
        const plan = await planMovieGrab(movie.tmdbId);

        if (plan?.release) {
            log(`movie ${ movie.tmdbId }: grabbing ${ plan.release.title }`);

            if (! isDryRun()) {
                const started = await executeMovieGrab(movie.tmdbId, plan.release);

                if (! started) {
                    await markMovieDownloading(movie.id, null);
                }
            }

            continue;
        }

        const attempts = movie.searchAttempts + 1;

        log(`movie ${ movie.tmdbId }: nothing suitable found (attempt ${ attempts }/${ MAX_ATTEMPTS })`);

        if (! isDryRun()) {
            await prisma.watchlist.update({
                where: { id: movie.id },
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
    const due = await prisma.watchlistEpisode.findMany({
        where: {
            status: { in: [ WatchStatus.PENDING, WatchStatus.SEARCHING ] },
            airDate: { not: null, lte: new Date() },
            season: { monitored: true },
            ...dueFilter()
        },
        include: { season: { include: { watchlist: true } } }
    });

    const seasons = new Map<string, typeof due>();

    for (const episode of due) {
        const key = `${ episode.season.watchlistId }:${ episode.season.seasonNumber }`;

        seasons.set(key, [ ...(seasons.get(key) || []), episode ]);
    }

    for (const episodes of seasons.values()) {
        const season = episodes[0].season;
        const tmdbId = season.watchlist.tmdbId;

        const plan = await planSeasonGrab(tmdbId, season.seasonNumber, {
            episodeNumbers: episodes.map(episode => episode.episodeNumber)
        });

        if (! plan) {
            continue;
        }

        // a pack is only worth it once an episode could not be found on its own
        const usePack = !! plan.pack && episodes.some(episode => {
            const available = plan.episodes.find(v => v.episodeNumber === episode.episodeNumber)?.release;

            return ! available && episode.searchAttempts + 1 >= PACK_AFTER_ATTEMPTS;
        });

        const due = episodes.map(episode => episode.episodeNumber);
        const grabs = planGrabs(plan, due, usePack);

        for (const grab of grabs) {
            log(`show ${ tmdbId } S${ season.seasonNumber } ${ grab.isPack ? "pack" : `E${ grab.episodeNumbers.join(",E") }` }: grabbing ${ grab.release.title }`);
        }

        if (! isDryRun() && grabs.length > 0) {
            await executeSeasonGrab(tmdbId, plan, { episodeNumbers: due, usePack });
        }

        const grabbed = new Set(grabs.flatMap(grab => grab.episodeNumbers));

        for (const episode of episodes) {
            if (grabbed.has(episode.episodeNumber)) {
                continue;
            }

            const attempts = episode.searchAttempts + 1;

            log(`show ${ tmdbId } S${ season.seasonNumber }E${ episode.episodeNumber }: nothing found (attempt ${ attempts }/${ MAX_ATTEMPTS })`);

            if (! isDryRun()) {
                await prisma.watchlistEpisode.update({
                    where: { id: episode.id },
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
