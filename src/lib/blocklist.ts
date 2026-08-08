import { BlockReason } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { settingNumber } from "@/lib/settings";

/**
 * Releases that were grabbed once and had to be thrown away, so a later search does
 * not walk into the same one again.
 *
 * This lived in memory until 2026-08-08, which meant every restart handed the same
 * fake release another chance — and on the day a padded `.scr` got in as an unaired
 * Silo episode, that was the difference between "blocked" and "blocked until you
 * restart the dev server". It is a table now.
 *
 * The read stays synchronous on purpose: `rateRelease` scores hundreds of candidates
 * in a tight loop and cannot await each one. The table is pulled into a set instead,
 * refreshed by the two entry points that start a search.
 */

// 0 = a stall is never forgiven either. A BAD_PAYLOAD never expires regardless: the
// content of a torrent does not improve with time.
const ttlDays = () => settingNumber("BLOCKED_RELEASE_TTL_DAYS");

// long enough that a scan round does not re-query per release, short enough that a
// block written by one request is seen by the next
const CACHE_MS = 60 * 1000;

type Cache = { titles: Set<string>, loadedAt: number };

// on global so hot reload does not drop it and force a re-read on every edit
const globalForBlocklist = global as unknown as { blocklist: Cache };
const cache: Cache = globalForBlocklist.blocklist || { titles: new Set<string>(), loadedAt: 0 };
globalForBlocklist.blocklist = cache;

/**
 * A stall can be bad luck rather than a dead release — no seeders that evening — so
 * those forget themselves. Something that was not the release at all never becomes it.
 */
const expiryFor = (reason: BlockReason) => {
    const days = ttlDays();

    if (reason === BlockReason.BAD_PAYLOAD || days <= 0) {
        return null;
    }

    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

/**
 * Call before scoring anything. An expired row is simply not read back, so nothing
 * has to sweep the table.
 */
export const refreshBlocklist = async (force = false) => {
    if (! force && Date.now() - cache.loadedAt < CACHE_MS) {
        return;
    }

    try {
        const rows = await prisma.blockedRelease.findMany({
            where: {
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: new Date() } }
                ]
            },
            select: { title: true }
        });

        cache.titles = new Set(rows.map(row => row.title));
        cache.loadedAt = Date.now();

    } catch(err) {
        // a database hiccup must not stop a download from being searched for; the
        // worst case is that a known bad release gets one more chance
        console.error(err);
    }
};

export const blockRelease = async (normalized: string, reason: BlockReason, detail?: string) => {
    if (! normalized) {
        return;
    }

    const expiresAt = expiryFor(reason);

    try {
        await prisma.blockedRelease.upsert({
            where: { title: normalized },
            update: { reason, detail: detail || null, blockedAt: new Date(), expiresAt },
            create: { title: normalized, reason, detail: detail || null, expiresAt }
        });

        // the cache is authoritative for the rest of this round
        cache.titles.add(normalized);

    } catch(err) {
        console.error(err);
    }
};

export const isReleaseBlocked = (normalized: string) => cache.titles.has(normalized);

export { BlockReason };
