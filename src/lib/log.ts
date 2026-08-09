import axios from "axios";

import { LogLevel, Prisma } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { settingFlag, settingNumber } from "@/lib/settings";

/**
 * The app's own log, in a table, so the admin page can answer "what did it do last
 * night" without a shell in the container.
 *
 * Three rules the rest of the code relies on:
 *
 * - **nothing here throws.** A log write that fails must never take down the operation
 *   it was describing — the worst case is a missing line.
 * - **the console gets every line too.** `writeLog` prints before it inserts, so
 *   `docker logs` is complete even while the database is down, and no call site has to
 *   remember to do both.
 * - **no secrets.** An api key that ends up in an error body is scrubbed here, at the one
 *   place every line goes through, rather than at forty call sites.
 */

/** The module a line came from, which is what the admin page filters on. */
export type LogSource =
    | "app"
    | "scheduler"
    | "download"
    | "watchlist"
    | "library"
    | "settings"
    | "tmdb"
    | "indexer"
    | "torrent"
    | "notify";

// worst first is what a level filter means: "warnings" includes errors
export const LOG_LEVELS = [ LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR ];

// a log line is a line. A stack trace belongs in the console, which has it
const MAX_MESSAGE = 500;
const MAX_DETAIL = 2000;

const clip = (value: string, max: number) => value.length > max ? `${ value.slice(0, max - 1) }…` : value;

/**
 * An error body can echo the request it rejected, and an indexer request carries its api
 * key in the query string. One regex at the choke point is worth more than remembering
 * this at every catch.
 */
const scrub = (value: string) => value
    .replace(/(apikey|api_key|apiKey|token|password|passwd|pass)=[^&\s"'<>]+/gi, "$1=***")
    // a telegram bot token is part of the path rather than a parameter
    .replace(/\/bot\d+:[\w-]+/g, "/bot***");

type Listener = () => void;

const globalForLog = global as unknown as {
    logListeners: Set<Listener>;
    logPrunedAt: number;
    logThrottle: Map<string, number>;
};

// on global so a hot reload does not leave the open streams behind, listening to a set
// nothing writes to any more
const listeners = globalForLog.logListeners || new Set<Listener>();
globalForLog.logListeners = listeners;

const throttled = globalForLog.logThrottle || new Map<string, number>();
globalForLog.logThrottle = throttled;

/**
 * Called after every write. A live stream uses it as "look at the table again" rather
 * than as the entry itself: the table stays the single source of truth, so nothing can
 * arrive twice or out of order.
 */
export const onLogWritten = (listener: Listener) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
};

const wake = () => {
    for (const listener of [ ...listeners ]) {
        try {
            listener();

        } catch(err) {
            console.error("[log] a listener failed", err);
        }
    }
};

const RETENTION_CHECK_MS = 60 * 60 * 1000;

/**
 * Retention is checked on the way out of a write instead of on a timer of its own: with
 * nothing being logged there is nothing to prune either, and this way it also works when
 * the scheduler is off.
 */
const prune = async () => {
    const days = settingNumber("LOG_RETENTION_DAYS");

    if (days <= 0 || Date.now() - (globalForLog.logPrunedAt || 0) < RETENTION_CHECK_MS) {
        return;
    }

    // claimed before the await, so a burst of writes does not all start pruning
    globalForLog.logPrunedAt = Date.now();

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await prisma.logEntry.deleteMany({ where: { at: { lt: cutoff } } });

    if (count > 0) {
        console.log(`[log] ${ count } entries older than ${ days } days were dropped`);
    }
};

const mirror = (level: LogLevel, source: LogSource, message: string, detail?: string) => {
    const line = `[${ source }] ${ message }${ detail ? ` — ${ detail }` : "" }`;

    if (level === LogLevel.ERROR) {
        console.error(line);

    } else if (level === LogLevel.WARN) {
        console.warn(line);

    } else {
        console.log(line);
    }
};

/**
 * One line. `DEBUG` is dropped unless somebody asked for it under Settings / Log —
 * otherwise every indexer search would be in here.
 */
export const writeLog = async (level: LogLevel, source: LogSource, message: string, detail?: string) => {
    const text = clip(scrub(message), MAX_MESSAGE);
    const extra = detail ? clip(scrub(detail), MAX_DETAIL) : null;

    mirror(level, source, text, extra || undefined);

    if (level === LogLevel.DEBUG && ! settingFlag("LOG_DEBUG")) {
        return;
    }

    try {
        await prisma.logEntry.create({ data: { level, source, message: text, detail: extra } });

        wake();

        await prune();

    } catch(err) {
        // the console already has the line, so this is the only loss
        console.error("[log] could not be written", err);
    }
};

export const logDebug = (source: LogSource, message: string, detail?: string) => writeLog(LogLevel.DEBUG, source, message, detail);
export const logInfo = (source: LogSource, message: string, detail?: string) => writeLog(LogLevel.INFO, source, message, detail);
export const logWarn = (source: LogSource, message: string, detail?: string) => writeLog(LogLevel.WARN, source, message, detail);
export const logError = (source: LogSource, message: string, detail?: string) => writeLog(LogLevel.ERROR, source, message, detail);

/**
 * For the failures that arrive in bursts: a wrong TMDB key fails every row of the home
 * page at once, and seven identical lines is not seven pieces of information. The first
 * one is written, the rest are dropped until the window is over.
 */
export const logThrottled = async (
    key: string,
    windowMs: number,
    level: LogLevel,
    source: LogSource,
    message: string,
    detail?: string
) => {
    const last = throttled.get(key) || 0;

    if (Date.now() - last < windowMs) {
        return;
    }

    throttled.set(key, Date.now());

    await writeLog(level, source, message, detail);
};

/** What went wrong in one line, with whatever the server said if it said anything. */
export const errorText = (err: unknown) => {
    if (axios.isAxiosError(err)) {
        const body = typeof err.response?.data === "string" ? err.response.data.slice(0, 200) : "";

        return [ err.response?.status ?? err.code, err.message, body ].filter(Boolean).join(" ");
    }

    return err instanceof Error ? err.message : String(err);
};

export type LogFilter = {
    // the lowest level to show: warn means warnings and errors
    level?: LogLevel;
    source?: string;
    q?: string;
};

const where = (filter: LogFilter): Prisma.LogEntryWhereInput => {
    const from = filter.level ? LOG_LEVELS.slice(LOG_LEVELS.indexOf(filter.level)) : LOG_LEVELS;

    return {
        level: { in: from },
        ...(filter.source ? { source: filter.source } : {}),
        ...(filter.q ? {
            OR: [
                { message: { contains: filter.q, mode: "insensitive" } },
                { detail: { contains: filter.q, mode: "insensitive" } }
            ]
        } : {})
    };
};

export const toLogFilter = (params: URLSearchParams): LogFilter => {
    const level = String(params.get("level") || "").toUpperCase();
    const q = (params.get("q") || "").trim();

    return {
        level: (LOG_LEVELS as string[]).includes(level) ? level as LogLevel : undefined,
        source: params.get("source") || undefined,
        q: q || undefined
    };
};

type Row = Awaited<ReturnType<typeof readLog>>[number];

export const toLogDto = (row: Row) => ({
    id: row.id,
    at: row.at.toISOString(),
    level: row.level,
    source: row.source,
    message: row.message,
    detail: row.detail
});

/** A page of the log, newest first. `before` is an id, so a new entry cannot shift it. */
export const readLog = async (filter: LogFilter, options: { before?: number, limit: number }) => {
    return await prisma.logEntry.findMany({
        where: {
            ...where(filter),
            ...(options.before ? { id: { lt: options.before } } : {})
        },
        orderBy: { id: "desc" },
        take: options.limit
    });
};

/** What a live stream has not seen yet, oldest first — the order it happened in. */
export const tailLog = async (filter: LogFilter, afterId: number, limit = 500) => {
    return await prisma.logEntry.findMany({
        where: { ...where(filter), id: { gt: afterId } },
        orderBy: { id: "asc" },
        take: limit
    });
};

/**
 * Where a stream starts when the client has nothing yet: the newest id whatever the
 * filter is, so an empty first page does not make the stream replay the whole table.
 */
export const newestLogId = async () => {
    const row = await prisma.logEntry.findFirst({ orderBy: { id: "desc" }, select: { id: true } });

    return row ? row.id : 0;
};

/** The sources actually in the table, for the filter — with counts, since we are here. */
export const logSources = async () => {
    const rows = await prisma.logEntry.groupBy({ by: [ "source" ], _count: { _all: true } });

    return rows
        .map(row => ({ source: row.source, count: row._count._all }))
        .sort((a, b) => b.count - a.count);
};

export const clearLog = async () => {
    const { count } = await prisma.logEntry.deleteMany({});

    return count;
};

export { LogLevel };
