import { ContentType, LibraryStatus, Prisma } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { getMediaMetadata } from "@/lib/media";
import { settingNumber } from "@/lib/settings";
import { removeTorrent, TorrentStatus } from "@/lib/torrent";
import { addToWatchlist, ensureEpisodeUnits, pruneWatchlistItem, toMediaType } from "@/lib/watchlist";
import { LibraryEntry, LibraryItem } from "@/types/library";
import { WatchlistDownload } from "@/types/watchlist";

export type LibraryRow = Prisma.LibraryItemGetPayload<{ include: { episodes: true } }>;

export type GrabbedEpisode = { seasonNumber: number, episodeNumber: number };

export const libraryInclude = { episodes: { orderBy: [ { seasonNumber: "asc" }, { episodeNumber: "asc" } ] } } satisfies Prisma.LibraryItemInclude;

const seedMs = () => settingNumber("LIBRARY_SEED_DAYS") * 24 * 60 * 60 * 1000;

/**
 * One tag scheme for everything, because a download is one row now: the torrent is
 * read back by the id of the row that is waiting for it.
 */
export const libraryTag = (itemId: number) => `aioseerr-${ itemId }`;

/** Inside the seed window, which is the only thing that blocks a delete. */
export const isSeeding = (item: { seedUntil: Date | null }) => !! item.seedUntil && item.seedUntil.getTime() > Date.now();

const code = (value: number) => String(value).padStart(2, "0");

/**
 * What one download covers, as a person would say it. The release title is the
 * other half of the story and is shown next to it.
 */
export const coverText = (episodes: { seasonNumber: number, episodeNumber: number }[]) => {
    if (episodes.length === 0) {
        return "";
    }

    const seasons = [ ...new Set(episodes.map(episode => episode.seasonNumber)) ].sort((a, b) => a - b);

    if (episodes.length === 1) {
        return `S${ code(seasons[0]) }E${ code(episodes[0].episodeNumber) }`;
    }

    const where = seasons.length === 1
        ? `S${ code(seasons[0]) }`
        : `S${ code(seasons[0]) }-S${ code(seasons[seasons.length - 1]) }`;

    return `${ where } — ${ episodes.length } episodes`;
};

export const libraryLabel = async (item: LibraryRow) => {
    const metadata = await getMediaMetadata(toMediaType(item.type), item.tmdbId);
    const name = metadata ? metadata.media.name : `TMDB #${ item.tmdbId }`;
    const covers = coverText(item.episodes);

    return covers ? `${ name } ${ covers }` : name;
};

/**
 * A download starts. The units it covers have nothing left to be found, so they
 * leave the watchlist and this row takes over — created before the torrent is
 * added, because its id is the tag the hash is read back by.
 */
export const moveToLibrary = async (input: {
    tmdbId: number;
    type: ContentType;
    releaseTitle: string;
    episodes: GrabbedEpisode[];
}): Promise<LibraryRow> => {
    const row = await prisma.watchlist.findUnique({ where: { tmdbId_type: { tmdbId: input.tmdbId, type: input.type } } });

    const where = input.episodes.length === 0
        ? { seasonNumber: null }
        : { OR: input.episodes.map(episode => ({ ...episode })) };

    // read before the units go: whether this was being watched is about to have no
    // other record anywhere
    const replaced = row
        ? await prisma.watchlistUnit.findMany({ where: { watchlistId: row.id, ...where } })
        : [];

    const item = await prisma.libraryItem.create({
        data: {
            tmdbId: input.tmdbId,
            type: input.type,
            releaseTitle: input.releaseTitle,
            watched: replaced.some(unit => unit.monitored),
            episodes: { create: input.episodes.map(episode => ({ ...episode })) }
        },
        include: libraryInclude
    });

    if (row) {
        await prisma.watchlistUnit.deleteMany({ where: { watchlistId: row.id, ...where } });

        // a film has nothing else to watch, so its row goes with the last unit
        await pruneWatchlistItem(row.id);
    }

    return item;
};

export const setTorrentHash = async (id: number, torrentHash: string) => {
    return await prisma.libraryItem.update({ where: { id }, data: { torrentHash }, include: libraryInclude });
};

/** The download finished: it can be watched, and the seed window starts now. */
export const markAvailable = async (id: number, releaseTitle: string) => {
    const completedAt = new Date();

    return await prisma.libraryItem.update({
        where: { id },
        data: {
            status: LibraryStatus.AVAILABLE,
            completedAt,
            seedUntil: new Date(completedAt.getTime() + seedMs()),
            ...(releaseTitle ? { releaseTitle } : {})
        }
    });
};

/**
 * The download never landed — failed, stalled, was a fake, or vanished from the
 * client. What it covered goes back on the watchlist and this row disappears; it
 * records a download, and there was none.
 *
 * It goes back **watched**, however it started. An instant download that fails has
 * nowhere else to live, and the alternative is that something the user asked for
 * quietly stops existing.
 */
export const restoreToWatchlist = async (item: LibraryRow) => {
    const created = await addToWatchlist(item.tmdbId, item.type, []);

    if (created) {
        if (item.type === ContentType.MOVIE) {
            await prisma.watchlistUnit.updateMany({
                where: { watchlistId: created.id, seasonNumber: null },
                data: { monitored: true, searchAttempts: { increment: 1 }, lastCheckedAt: null }
            });

        } else {
            for (const season of [ ...new Set(item.episodes.map(episode => episode.seasonNumber)) ]) {
                const episodes = item.episodes
                    .filter(episode => episode.seasonNumber === season)
                    .map(episode => episode.episodeNumber);

                await ensureEpisodeUnits(created.id, item.tmdbId, season, episodes, true);
            }

            // due at once: the release that failed is on the blocklist, so the next
            // round looks for a different one rather than the same dead torrent
            await prisma.watchlistUnit.updateMany({
                where: { watchlistId: created.id },
                data: { lastCheckedAt: null }
            });
        }
    }

    await prisma.libraryItem.delete({ where: { id: item.id } });

    return created;
};

/**
 * Gone, but remembered. Dropping the row outright would leave the scanner with no
 * idea the episode was ever obtained, and it would fetch it all over again.
 */
export const forgetLibraryItem = async (id: number) => {
    return await prisma.libraryItem.update({
        where: { id },
        data: { removedAt: new Date(), torrentHash: null, deleteRequested: false }
    });
};

/**
 * Every episode this title has or is getting. The scanner asks before it searches,
 * and a manual download asks before it starts — a removed one is not in here, so
 * asking for it again is allowed.
 */
export const heldEpisodes = async (tmdbId: number) => {
    const episodes = await prisma.libraryEpisode.findMany({
        where: { item: { tmdbId, removedAt: null } },
        select: { seasonNumber: true, episodeNumber: true }
    });

    return new Set(episodes.map(episode => `${ episode.seasonNumber }:${ episode.episodeNumber }`));
};

/** Whether anything of this season is already downloading or on disk. */
export const seasonStarted = async (tmdbId: number, seasonNumber: number) => {
    return await prisma.libraryEpisode.count({
        where: { seasonNumber, item: { tmdbId, removedAt: null } }
    }) > 0;
};

export const getLibraryItem = async (id: number) => {
    return await prisma.libraryItem.findUnique({ where: { id }, include: libraryInclude });
};

export const requestDelete = async (id: number, deleteFiles: boolean) => {
    return await prisma.libraryItem.update({ where: { id }, data: { deleteRequested: true, deleteFiles } });
};

export const cancelDelete = async (id: number) => {
    return await prisma.libraryItem.update({ where: { id }, data: { deleteRequested: false } });
};

/**
 * Carries the deletion out. The torrent goes from the client either way, the files
 * only if asked — the one action in the app that cannot be undone.
 */
export const deleteLibraryItem = async (item: LibraryRow, deleteFiles: boolean) => {
    if (item.torrentHash) {
        await removeTorrent(item.torrentHash, deleteFiles);
    }

    return await forgetLibraryItem(item.id);
};

/**
 * What was marked for deletion while it was still seeding, once the window closes.
 * Runs with the client read back, so a minute is the worst case lateness.
 */
export const runLibraryCleanup = async () => {
    const due = await prisma.libraryItem.findMany({
        where: {
            deleteRequested: true,
            removedAt: null,
            OR: [ { seedUntil: null }, { seedUntil: { lte: new Date() } } ]
        },
        include: libraryInclude
    });

    for (const item of due) {
        await deleteLibraryItem(item, item.deleteFiles);
    }

    return due;
};

const toDownload = (torrent: TorrentStatus): WatchlistDownload => ({
    name: torrent.name,
    state: torrent.state,
    progress: torrent.progress,
    downloadSpeed: torrent.downloadSpeed,
    eta: torrent.eta,
    size: torrent.size
});

export const toLibraryEntry = (item: LibraryRow): LibraryEntry => ({
    id: item.id,
    tmdbId: item.tmdbId,
    type: toMediaType(item.type),
    status: item.status,
    releaseTitle: item.releaseTitle,
    covers: coverText(item.episodes),
    episodeCount: item.episodes.length,
    startedAt: item.startedAt.toISOString(),
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    seedUntil: item.seedUntil ? item.seedUntil.toISOString() : null,
    seeding: isSeeding(item),
    deleteRequested: item.deleteRequested,
    deleteFiles: item.deleteFiles
});

/**
 * With `torrents` the live client state is joined on; the caller reads it once for
 * the whole page. Removed rows are the scanner's memory, not a listing.
 */
export const getLibrary = async (torrents: TorrentStatus[] | null = null): Promise<LibraryItem[]> => {
    const items = await prisma.libraryItem.findMany({
        where: { removedAt: null },
        include: libraryInclude,
        orderBy: { startedAt: "desc" }
    });

    const byHash = new Map((torrents || []).map(torrent => [ torrent.hash.toLowerCase(), torrent ]));

    return await Promise.all(items.map(async item => {
        const metadata = await getMediaMetadata(toMediaType(item.type), item.tmdbId);
        const torrent = item.torrentHash ? byHash.get(item.torrentHash.toLowerCase()) : undefined;

        return {
            ...toLibraryEntry(item),
            media: metadata ? metadata.media : null,
            ...(torrents ? { download: torrent ? toDownload(torrent) : null } : {})
        };
    }));
};
