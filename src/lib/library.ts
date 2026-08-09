import { ContentType, Library as LibraryRow, LibraryStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { LibraryAudience, libraryFilter } from "@/lib/audience";
import { getMediaMetadata } from "@/lib/media";
import { settingNumber } from "@/lib/settings";
import { removeTorrent, TorrentStatus } from "@/lib/torrent";
import { addToWatchlist, ensureEpisodeUnits, pruneWatchlistItem, rowsForTitle, toMediaType } from "@/lib/watchlist";
import { LibraryEntry, LibraryItem } from "@/types/library";
import { WatchlistDownload } from "@/types/watchlist";

export type { LibraryRow };

export type GrabbedEpisode = { seasonNumber: number, episodeNumber: number };

/**
 * How an episode is written down on a download. One string instead of two columns,
 * because every question about them — "do I have this", "was this season started",
 * "what is the highest one seen" — is asked about one title and answered by a set.
 */
export const episodeKey = (episode: GrabbedEpisode) => `${ episode.seasonNumber }:${ episode.episodeNumber }`;

export const toEpisode = (key: string): GrabbedEpisode => {
    const [ seasonNumber, episodeNumber ] = key.split(":").map(Number);

    return { seasonNumber, episodeNumber };
};

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
export const coverText = (keys: string[]) => {
    if (keys.length === 0) {
        return "";
    }

    const episodes = keys.map(toEpisode);
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
    /// the edition this is, which is what decides whose search it ends
    language: string;
    /// whose lists this answers: the people it was searched for, and nobody else
    forUsers: number[];
    /// whoever pressed the button, for a download nobody had on a list yet
    requestedBy?: number | null;
}): Promise<LibraryRow> => {
    // Not everybody who is waiting for the title — everybody who is waiting for *this
    // edition* of it. One file answers the lists it is in the right language for, and
    // the others go on being searched for, because to them it is a different film.
    const all = await rowsForTitle(input.tmdbId, input.type);
    const rows = all.filter(row => input.forUsers.includes(row.userId));
    const ids = rows.map(row => row.id);

    const where = input.episodes.length === 0
        ? { seasonNumber: null }
        : { OR: input.episodes.map(episode => ({ ...episode })) };

    // read before the units go: who was watching this is about to have no other
    // record anywhere
    const replaced = ids.length > 0
        ? await prisma.watchlistUnit.findMany({ where: { watchlistId: { in: ids }, ...where } })
        : [];

    const owner = new Map(rows.map(row => [ row.id, row.userId ]));

    const watchedBy = [ ...new Set([
        ...replaced.filter(unit => unit.monitored).map(unit => owner.get(unit.watchlistId)!),
        // an instant download is on nobody's list, and without this it would be
        // nobody's download either — no notification, and nothing to restore it to
        ...(input.requestedBy ? [ input.requestedBy ] : [])
    ]) ];

    const item = await prisma.library.create({
        data: {
            tmdbId: input.tmdbId,
            type: input.type,
            releaseTitle: input.releaseTitle,
            language: input.language,
            watchedBy,
            episodes: input.episodes.map(episodeKey)
        }
    });

    if (ids.length > 0) {
        await prisma.watchlistUnit.deleteMany({ where: { watchlistId: { in: ids }, ...where } });

        // a film has nothing else to watch, so its row goes with the last unit
        for (const id of ids) {
            await pruneWatchlistItem(id);
        }
    }

    return item;
};

/**
 * The other half of `moveToLibrary`, for the people who were not in the round.
 *
 * A grab only carries off the units of the people it was searched for — everybody
 * else goes on looking, which is the point when the language differs. But somebody
 * whose language is the *same* and who simply was not due this round would then wait
 * for a file that is already on the disk: the scanner sees the edition is held and
 * skips, so their unit is never taken by anything and never expires.
 *
 * So before a search is skipped, whoever it would have been for is written onto the
 * download that already answers them, and their units go the same way they would have
 * gone had they been in the round.
 */
export const claimHeldUnits = async (tmdbId: number, type: ContentType, audience: LibraryAudience) => {
    const items = await prisma.library.findMany({ where: { tmdbId, type, ...libraryFilter(audience) } });

    if (items.length === 0) {
        return 0;
    }

    const rows = (await rowsForTitle(tmdbId, type)).filter(row => audience.userIds.includes(row.userId));

    if (rows.length === 0) {
        return 0;
    }

    const ids = rows.map(row => row.id);
    const owner = new Map(rows.map(row => [ row.id, row.userId ]));
    let claimed = 0;

    for (const item of items) {
        const where = item.episodes.length === 0
            ? { seasonNumber: null }
            : { OR: item.episodes.map(toEpisode) };

        const units = await prisma.watchlistUnit.findMany({ where: { watchlistId: { in: ids }, ...where } });

        if (units.length === 0) {
            continue;
        }

        const waiting = [ ...new Set(units.map(unit => owner.get(unit.watchlistId)!)) ];

        await prisma.library.update({
            where: { id: item.id },
            // they were waiting for exactly this, so they are told when it lands and it
            // goes back on their list if it never does
            data: { watchedBy: [ ...new Set([ ...item.watchedBy, ...waiting ]) ] }
        });

        await prisma.watchlistUnit.deleteMany({ where: { id: { in: units.map(unit => unit.id) } } });

        claimed += units.length;
    }

    if (claimed > 0) {
        for (const id of ids) {
            await pruneWatchlistItem(id);
        }
    }

    return claimed;
};

export const setTorrentHash = async (id: number, torrentHash: string) => {
    return await prisma.library.update({ where: { id }, data: { torrentHash } });
};

/** The download finished: it can be watched, and the seed window starts now. */
export const markAvailable = async (id: number, releaseTitle: string) => {
    const completedAt = new Date();

    return await prisma.library.update({
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
 *
 * And it goes back to **everybody** it was taken from. `watchedBy` is the list this
 * download emptied; a restore that only served one of them would silently stop
 * looking for the others.
 */
export const restoreToWatchlist = async (item: LibraryRow) => {
    const restored = [];

    for (const userId of item.watchedBy) {
        const created = await addToWatchlist(userId, item.tmdbId, item.type, []);

        if (! created) {
            continue;
        }

        if (item.type === ContentType.MOVIE) {
            await prisma.watchlistUnit.updateMany({
                where: { watchlistId: created.id, seasonNumber: null },
                data: { monitored: true, searchAttempts: { increment: 1 }, lastCheckedAt: null }
            });

        } else {
            const covered = item.episodes.map(toEpisode);

            for (const season of [ ...new Set(covered.map(episode => episode.seasonNumber)) ]) {
                const episodes = covered
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

        restored.push(created);
    }

    await prisma.library.delete({ where: { id: item.id } });

    return restored;
};

/**
 * Gone. A row that covers episodes is kept as a tombstone: it is the only record
 * that they were ever obtained, and `syncTvSeasons` reads it so a deleted episode
 * is not offered all over again.
 *
 * A film has no episodes and so remembers nothing — every other query in the app
 * skips removed rows anyway, so keeping one would only be a row nobody can see and
 * nobody reads. That one goes for good.
 */
export const forgetLibraryItem = async (item: LibraryRow) => {
    if (item.episodes.length === 0) {
        return await prisma.library.delete({ where: { id: item.id } });
    }

    return await prisma.library.update({
        where: { id: item.id },
        data: { removedAt: new Date(), torrentHash: null, deleteRequested: false }
    });
};

/**
 * Every episode this title has or is getting **in this edition**. The scanner asks
 * before it searches, and a manual download asks before it starts — a removed one is
 * not in here, so asking for it again is allowed.
 */
export const heldEpisodes = async (tmdbId: number, audience: LibraryAudience) => {
    const items = await prisma.library.findMany({
        where: { tmdbId, ...libraryFilter(audience) },
        select: { episodes: true }
    });

    return new Set(items.flatMap(item => item.episodes));
};

/**
 * Whether the title has anything in the library at all. A film has no episodes, so
 * `heldEpisodes` cannot answer this for one.
 */
export const hasLibraryItem = async (tmdbId: number, audience: LibraryAudience) => {
    return await prisma.library.count({ where: { tmdbId, ...libraryFilter(audience) } }) > 0;
};

/** Whether anything of this season is already downloading or on disk. */
export const seasonStarted = async (tmdbId: number, seasonNumber: number, audience: LibraryAudience) => {
    const episodes = await heldEpisodes(tmdbId, audience);

    return [ ...episodes ].some(key => toEpisode(key).seasonNumber === seasonNumber);
};

export const getLibraryItem = async (id: number) => {
    return await prisma.library.findUnique({ where: { id } });
};

export const requestDelete = async (id: number, deleteFiles: boolean) => {
    return await prisma.library.update({ where: { id }, data: { deleteRequested: true, deleteFiles } });
};

export const cancelDelete = async (id: number) => {
    return await prisma.library.update({ where: { id }, data: { deleteRequested: false } });
};

/**
 * Carries the deletion out. The torrent goes from the client either way, the files
 * only if asked — the one action in the app that cannot be undone.
 */
export const deleteLibraryItem = async (item: LibraryRow, deleteFiles: boolean) => {
    if (item.torrentHash) {
        await removeTorrent(item.torrentHash, deleteFiles);
    }

    return await forgetLibraryItem(item);
};

/**
 * What was marked for deletion while it was still seeding, once the window closes.
 * Runs with the client read back, so a minute is the worst case lateness.
 */
export const runLibraryCleanup = async () => {
    const due = await prisma.library.findMany({
        where: {
            deleteRequested: true,
            removedAt: null,
            OR: [ { seedUntil: null }, { seedUntil: { lte: new Date() } } ]
        },
    });

    for (const item of due) {
        await deleteLibraryItem(item, item.deleteFiles);
    }

    // tombstones that remember nothing, left by an earlier rule that kept every
    // removed row. nothing reads them and nothing shows them
    await prisma.library.deleteMany({ where: { removedAt: { not: null }, episodes: { isEmpty: true } } });

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

export const toLibraryEntry = (item: LibraryRow, names: Map<number, string> = new Map()): LibraryEntry => ({
    watchers: item.watchedBy.map(id => names.get(id)).filter((name): name is string => !! name),
    id: item.id,
    tmdbId: item.tmdbId,
    type: toMediaType(item.type),
    status: item.status,
    releaseTitle: item.releaseTitle,
    language: item.language,
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
    const items = await prisma.library.findMany({
        where: { removedAt: null },
        orderBy: { startedAt: "desc" }
    });

    const byHash = new Map((torrents || []).map(torrent => [ torrent.hash.toLowerCase(), torrent ]));

    // one lookup for the whole page rather than one per row, and a deleted account
    // simply drops out of the list instead of showing as a number
    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const names = new Map(users.map(user => [ user.id, user.name ]));

    return await Promise.all(items.map(async item => {
        const metadata = await getMediaMetadata(toMediaType(item.type), item.tmdbId);
        const torrent = item.torrentHash ? byHash.get(item.torrentHash.toLowerCase()) : undefined;

        return {
            ...toLibraryEntry(item, names),
            media: metadata ? metadata.media : null,
            ...(torrents ? { download: torrent ? toDownload(torrent) : null } : {})
        };
    }));
};
