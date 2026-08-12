import { ContentType, Library as LibraryRow, LibraryStatus } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { LibraryAudience, libraryFilter } from "@/lib/audience";
import { installId } from "@/lib/install";
import { getMediaMetadata, RECORD_LANGUAGE } from "@/lib/media";
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** How much seeding is owed before a download may be deleted. */
const seedRequiredMs = () => Math.max(settingNumber("LIBRARY_SEED_DAYS"), 0) * DAY_MS;

/**
 * How long a finished download is kept. 0 is off, and off is the safe direction: the
 * whole library staying is a disk filling up, a retention that fires by accident is
 * files that are not coming back.
 */
const retentionMs = () => Math.max(settingNumber("LIBRARY_RETENTION_DAYS"), 0) * DAY_MS;

/**
 * One tag scheme for everything, because a download is one row now: the torrent is
 * read back by the id of the row that is waiting for it.
 *
 * The install's own id is in there because a row id is only unique inside one database,
 * while a tag in qBittorrent outlives every database that ever wrote it. A second install
 * on the same client, or a recreated one, hands out id 12 again — and the lookup then
 * finds the *old* torrent that still carries `aioseerr-12`. On 2026-08-11 that is how the
 * Devil Wears Prada 2 row came to follow a stranger's Obsession torrent while the film it
 * actually downloaded sat in the client with nothing pointing at it. See `installId`.
 */
export const libraryTag = async (itemId: number) => `aioseerr-${ await installId() }-${ itemId }`;

/**
 * The live row that is already following this torrent, if there is one. Two rows on one
 * hash is never right: they finish together, they both claim its name and size, and the
 * first deletion takes the other one's files with it. So a hash somebody else holds is
 * refused at the grab rather than written down.
 */
export const rowHoldingTorrent = async (torrentHash: string, exceptId: number) => {
    return await prisma.library.findFirst({
        where: {
            torrentHash: { equals: torrentHash, mode: "insensitive" },
            removedAt: null,
            id: { not: exceptId }
        }
    });
};

/**
 * Inside the seed window, which is the only thing that blocks a delete. The date it reads
 * is kept in step with the client's own `seeding_time` — see `syncSeedWindow`.
 */
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

/**
 * What this download is called, for a log line and for the notification that goes with it.
 * The record language, for the same reason as the log itself: it is written once, and not
 * for one particular reader.
 */
export const libraryLabel = async (item: LibraryRow) => {
    const metadata = await getMediaMetadata(toMediaType(item.type), item.tmdbId, RECORD_LANGUAGE);
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

/**
 * When the seed time will be up, given how much of it the client says has passed
 * already. A projection, not a stopwatch: `seeding_time` is the truth and this is the
 * moment it is on course to reach the requirement.
 *
 * That is what makes a paused torrent behave correctly. It is not seeding, so its
 * `seeding_time` stands still, so every round pushes this date out by the round it just
 * spent — a torrent nobody is uploading from never becomes deletable, which is the whole
 * point of having a seed window at all.
 */
const seedUntilFrom = (seedingTimeSeconds: number) => {
    const owed = Math.max(seedRequiredMs() - seedingTimeSeconds * 1000, 0);

    return new Date(Date.now() + owed);
};

/**
 * The download finished: it can be watched, the seed clock is read off the client, and
 * the retention clock starts now. The size is written down here rather than read live
 * from the client every time the table is drawn — the torrent outlives the download,
 * but not by much, and a listing that forgets how big something was the moment it is
 * removed from qBittorrent is a listing that cannot answer "what is filling the disk".
 *
 * `seedingTime` matters even here, at the first sight of a finished download: the app may
 * have been off, or the torrent may have been added by hand hours ago, and starting the
 * window from "now" would then ask for the seeding twice.
 */
export const markAvailable = async (id: number, releaseTitle: string, sizeBytes?: number, seedingTime = 0) => {
    const completedAt = new Date();

    return await prisma.library.update({
        where: { id },
        data: {
            status: LibraryStatus.AVAILABLE,
            completedAt,
            seedUntil: seedUntilFrom(seedingTime),
            ...(releaseTitle ? { releaseTitle } : {}),
            ...(sizeBytes ? { sizeBytes } : {})
        }
    });
};

// one round's worth of slack: while the torrent really is seeding, the projected date
// barely moves, and rewriting it every minute for that would be a write with nothing in it
const SEED_DRIFT_MS = 2 * 60 * 1000;

/**
 * Keeps the stored date in step with the client's own seeding time, once a round.
 *
 * Why it is stored at all rather than asked live: everything else — the delete guard, the
 * cleanup query, the table — reads one date off the row, and half of those never talk to
 * qBittorrent. So this is the one place the client's answer is turned into that date.
 *
 * It moves in both directions on purpose. Forward when the torrent is not actually seeding,
 * and *backwards* when it turns out to have seeded longer than the app assumed — a week of
 * downtime, or a torrent that was complete before the app ever saw it, should not cost
 * another three days.
 */
export const syncSeedWindow = async (item: LibraryRow, seedingTimeSeconds: number) => {
    const wanted = seedUntilFrom(seedingTimeSeconds);
    const stored = item.seedUntil;

    if (stored && Math.abs(stored.getTime() - wanted.getTime()) <= SEED_DRIFT_MS) {
        return null;
    }

    // the requirement is met and the row already says so: nothing to keep writing
    if (stored && stored.getTime() <= Date.now() && wanted.getTime() <= Date.now()) {
        return null;
    }

    return await prisma.library.update({ where: { id: item.id }, data: { seedUntil: wanted } });
};

/** What the client says it is, kept for the listing. */
export const setSize = async (id: number, sizeBytes: number) => {
    return await prisma.library.update({ where: { id }, data: { sizeBytes } });
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

export const requestDelete = async (id: number, deleteFiles: boolean, requestedBy: number | null = null) => {
    return await prisma.library.update({
        where: { id },
        // the mark and the deletion can be days apart, so whose decision it was has to
        // be written down now — by then there is nobody signed in to ask
        data: { deleteRequested: true, deleteFiles, deleteRequestedBy: requestedBy }
    });
};

export const cancelDelete = async (id: number) => {
    return await prisma.library.update({ where: { id }, data: { deleteRequested: false, deleteRequestedBy: null } });
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

/** Why a row went in a cleanup round, which is also what the notification says. */
export type CleanedUp = { item: LibraryRow, why: "marked" | "expired" };

/**
 * Everything the app deletes on its own. Runs with the client read back, so a minute is
 * the worst case lateness.
 *
 * Two reasons, in this order. **Marked**: somebody pressed delete while it was still
 * seeding, and it goes the moment the window closes — their decision, carried out late.
 * **Expired**: the retention time ran out, and nobody decided anything; this is the one
 * thing in the app that destroys files without being asked, so it is deliberately narrow.
 * Only a finished download, only past its seed window, only counted from the moment it
 * became watchable, and only while the setting is not 0.
 */
export const runLibraryCleanup = async (): Promise<CleanedUp[]> => {
    const now = new Date();

    const seedIsUp = { OR: [ { seedUntil: null }, { seedUntil: { lte: now } } ] };

    const marked = await prisma.library.findMany({
        where: { deleteRequested: true, removedAt: null, ...seedIsUp }
    });

    const keepMs = retentionMs();

    // a row that never finished has no retention clock: what it needs is another search,
    // and syncDownloads is what decides that
    const expired = keepMs > 0
        ? await prisma.library.findMany({
            where: {
                deleteRequested: false,
                removedAt: null,
                status: LibraryStatus.AVAILABLE,
                completedAt: { not: null, lte: new Date(now.getTime() - keepMs) },
                ...seedIsUp
            }
        })
        : [];

    const done: CleanedUp[] = [
        ...marked.map((item): CleanedUp => ({ item, why: "marked" })),
        // the retention takes the files with it. Leaving them would be the worst of both:
        // the row is gone, so nothing in the app knows about them any more, and the disk
        // is exactly as full as it was
        ...expired.map((item): CleanedUp => ({ item, why: "expired" }))
    ];

    for (const { item, why } of done) {
        await deleteLibraryItem(item, why === "expired" ? true : item.deleteFiles);
    }

    // tombstones that remember nothing, left by an earlier rule that kept every
    // removed row. nothing reads them and nothing shows them
    await prisma.library.deleteMany({ where: { removedAt: { not: null }, episodes: { isEmpty: true } } });

    return done;
};

/**
 * What this person has on the way, or on the shelf — for the rows at the top of the
 * home page.
 *
 * It has to come from here rather than from the watchlist: a download takes its units
 * with it, so the moment one starts the title has no watchlist row left at all, and a
 * row built from watchlist rows could only ever be empty for a film.
 *
 * One card per title, not per torrent: ten episode rows of the same show are one
 * thing to look at.
 */
export const getPersonalLibrary = async (userId: number, status: LibraryStatus) => {
    const items = await prisma.library.findMany({
        where: { removedAt: null, status, watchedBy: { has: userId } },
        orderBy: { startedAt: "desc" }
    });

    const seen = new Set<string>();
    const media = [];

    for (const item of items) {
        const type = toMediaType(item.type);
        const id = `${ type }:${ item.tmdbId }`;

        if (seen.has(id)) {
            continue;
        }

        seen.add(id);

        const metadata = await getMediaMetadata(type, item.tmdbId);

        if (metadata) {
            media.push(metadata.media);
        }
    }

    return media;
};

const toDownload = (torrent: TorrentStatus): WatchlistDownload => ({
    name: torrent.name,
    state: torrent.state,
    progress: torrent.progress,
    downloadSpeed: torrent.downloadSpeed,
    eta: torrent.eta,
    size: torrent.size
});

/**
 * When the retention will take it, if it is on. Computed rather than stored: the setting
 * can be changed, and a date frozen into a column would go on promising the old one.
 */
const expiresAt = (item: LibraryRow) => {
    const keepMs = retentionMs();

    if (keepMs === 0 || ! item.completedAt) {
        return null;
    }

    // the seed window holds it back, so the later of the two is when it really goes
    const due = new Date(item.completedAt.getTime() + keepMs);

    return item.seedUntil && item.seedUntil > due ? item.seedUntil : due;
};

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
    sizeBytes: item.sizeBytes,
    startedAt: item.startedAt.toISOString(),
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    seedUntil: item.seedUntil ? item.seedUntil.toISOString() : null,
    seeding: isSeeding(item),
    expiresAt: expiresAt(item)?.toISOString() || null,
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
            // a download that is still going has nothing written down yet, and the
            // client knows the answer — the stored value wins once there is one
            ...(! item.sizeBytes && torrent ? { sizeBytes: torrent.size } : {}),
            media: metadata ? metadata.media : null,
            ...(torrents ? { download: torrent ? toDownload(torrent) : null } : {})
        };
    }));
};
