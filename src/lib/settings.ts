import { prisma } from "@/lib/prisma";

/**
 * Settings that can be edited from the admin page, and the one place that knows how to
 * read them.
 *
 * **Layering.** A `Setting` row wins, the env is what it falls back to. Nothing is
 * copied into the table at boot: a row exists only for a key somebody deliberately
 * changed, so the table reads as a list of decisions and `.env` keeps working for
 * everything else. Clearing a field in the UI deletes the row, which is also how you
 * go back to what the env says.
 *
 * **Why the read is synchronous.** `getQualityProfile()` and friends are called inside
 * scoring loops and cannot await per value, exactly like the blocklist. So the table is
 * pulled into a map and read from memory; `loadSettings()` warms it at boot and every
 * scan round, and a save updates it in place.
 *
 * **A cold cache is never wrong, only stale**: with no rows read yet every key falls
 * through to the env, which is what the app did before this file existed.
 */

export type SettingType = "string" | "number" | "boolean" | "list" | "table";

export type SettingDef = {
    key: string;
    group: string;
    label: string;
    type: SettingType;
    // a secret is never sent to the browser — it can be replaced, not read back
    secret?: boolean;
    help?: string;
    placeholder?: string;
};

/**
 * Deliberately not here: `DATABASE_*` and `APP_*` (needed to reach this table in the
 * first place), and `SCAN_DISABLED` — an emergency brake belongs somewhere the app
 * cannot talk itself out of.
 */
export const SETTINGS: SettingDef[] = [
    // TMDB
    { key: "TMDB_API_KEY", group: "TMDB", label: "API key", type: "string", secret: true },
    { key: "TMDB_LANGUAGE", group: "TMDB", label: "Language", type: "string", placeholder: "en-US", help: "Also decides which titles the indexer search falls back to." },
    { key: "TMDB_REGION", group: "TMDB", label: "Region", type: "string", placeholder: "US", help: "Whose age rating to show. Taken from the language when empty." },
    { key: "TMDB_CACHE_TTL_MINUTES", group: "TMDB", label: "Metadata cache (minutes)", type: "number", placeholder: "720" },
    { key: "DISCOVER_CACHE_TTL_MINUTES", group: "TMDB", label: "Discover row cache (minutes)", type: "number", placeholder: "60", help: "Trending moves faster than metadata, so it gets its own, shorter cache." },

    // Indexers
    { key: "INDEXER_URL", group: "Indexers", label: "Jackett / Prowlarr URL", type: "string", placeholder: "http://host:9117" },
    { key: "INDEXER_API_KEY", group: "Indexers", label: "API key", type: "string", secret: true },
    { key: "INDEXER_IDS", group: "Indexers", label: "Indexers", type: "list", placeholder: "ncore,limetorrents,thepiratebay", help: "Queried one by one, by capability. The order is also the priority." },
    { key: "INDEXER_PRIORITY", group: "Indexers", label: "Priority order", type: "list", help: "Only if it should differ from the order above." },
    { key: "INDEXER_PRIORITY_BONUS", group: "Indexers", label: "Priority weight", type: "number", placeholder: "100000", help: "High enough and the preferred indexer always wins at equal resolution; lower it and the seeder count can decide." },
    { key: "INDEXER_CAPS_TTL_MINUTES", group: "Indexers", label: "Capability cache (minutes)", type: "number", placeholder: "360" },

    // Torrent client
    { key: "TORRENT_URL", group: "Torrent client", label: "qBittorrent URL", type: "string", placeholder: "http://host:8080" },
    { key: "TORRENT_USER", group: "Torrent client", label: "User", type: "string" },
    { key: "TORRENT_PASS", group: "Torrent client", label: "Password", type: "string", secret: true },
    { key: "TORRENT_CATEGORY", group: "Torrent client", label: "Category", type: "string", placeholder: "aioseerr", help: "Everything this app manages carries it, and nothing outside it is ever touched." },
    { key: "TORRENT_MOVIE_PATH", group: "Torrent client", label: "Film save path", type: "string", help: "Empty leaves the destination to the category." },
    { key: "TORRENT_SERIES_PATH", group: "Torrent client", label: "Series save path", type: "string" },

    // Quality
    { key: "QUALITY_RESOLUTIONS", group: "Quality", label: "Resolutions, best first", type: "list", placeholder: "1080p,720p,2160p", help: "Anything not listed is rejected. An unrecognised resolution is kept as a last resort." },
    { key: "QUALITY_PREFERRED_CODECS", group: "Quality", label: "Preferred codecs", type: "list", placeholder: "x264,h264,avc" },
    { key: "QUALITY_CODEC_BONUS", group: "Quality", label: "Codec bonus", type: "number", placeholder: "500", help: "Worth this many seeders." },
    { key: "QUALITY_MIN_SEEDERS", group: "Quality", label: "Minimum seeders", type: "number", placeholder: "1" },
    { key: "QUALITY_MAX_SIZE_GB", group: "Quality", label: "Maximum size (GB)", type: "number", placeholder: "0", help: "0 = no limit." },
    { key: "QUALITY_MAX_PACK_SIZE_PER_EPISODE_GB", group: "Quality", label: "Season pack ceiling per episode (GB)", type: "number", placeholder: "5", help: "A 2160p pack can run to 89–189 GB, which is what this is for." },
    { key: "QUALITY_EXCLUDE", group: "Quality", label: "Excluded keywords", type: "list", placeholder: "cam,hdcam,ts,telesync,screener", help: "Matched on word boundaries, so 'ts' does not hit random words." },
    { key: "QUALITY_MIN_SIZE_MOVIE", group: "Quality", label: "Minimum film size per resolution", type: "table", placeholder: "2160p:8,1080p:2,720p:0.8,480p:0.3", help: "A file this much smaller than the resolution it claims is not that video. GB per entry." },
    { key: "QUALITY_MIN_SIZE_EPISODE", group: "Quality", label: "Minimum episode size per resolution", type: "table", placeholder: "2160p:1.5,1080p:0.4,720p:0.15,480p:0.05" },

    // Language
    { key: "QUALITY_PREFERRED_LANGUAGES", group: "Language", label: "Preferred languages", type: "list", placeholder: "hun,eng", help: "First one wins." },
    { key: "QUALITY_DEFAULT_LANGUAGE", group: "Language", label: "Untagged release counts as", type: "string", placeholder: "eng" },
    { key: "QUALITY_EXCLUDE_LANGUAGES", group: "Language", label: "Excluded languages", type: "list", help: "Never applies to a title's own original language, or foreign films would become unobtainable." },
    { key: "QUALITY_LANGUAGE_BONUS", group: "Language", label: "Language bonus", type: "number", placeholder: "1000000" },
    { key: "QUALITY_LANGUAGE_FIRST", group: "Language", label: "Language outranks resolution", type: "boolean", help: "On: a 720p Hungarian release beats a 1080p English one." },

    // Scanner
    { key: "WATCHLIST_SCAN_INTERVAL_MINUTES", group: "Scanner", label: "Scan every (minutes)", type: "number", placeholder: "15" },
    { key: "DOWNLOAD_SYNC_INTERVAL_MINUTES", group: "Scanner", label: "Read the client back every (minutes)", type: "number", placeholder: "1" },
    { key: "SEARCH_BACKOFF_MINUTES", group: "Scanner", label: "First wait after an empty search (minutes)", type: "number", placeholder: "30", help: "Doubles with every fruitless search. Nothing is ever given up on." },
    { key: "SEARCH_MAX_BACKOFF_HOURS", group: "Scanner", label: "Longest wait (hours)", type: "number", placeholder: "24" },
    { key: "EPISODE_SEARCH_CONCURRENCY", group: "Scanner", label: "Parallel episode searches", type: "number", placeholder: "3" },
    { key: "SCAN_DRY_RUN", group: "Scanner", label: "Dry run", type: "boolean", help: "On: the scanner only logs what it would grab. Manual downloads are always real." },

    // Content check
    { key: "PAYLOAD_VIDEO_EXTENSIONS", group: "Content check", label: "Video extensions", type: "list", placeholder: "mkv,mp4,avi,iso", help: "Empty turns this rule off — it cannot mean 'nothing is a video', that would delete every torrent. * accepts everything." },
    { key: "PAYLOAD_ARCHIVE_EXTENSIONS", group: "Content check", label: "Archive extensions", type: "list", placeholder: "rar,zip,7z", help: "An archived release cannot be judged from a file list, so it is never called bad. .r00-.r99 follow 'rar'." },
    { key: "PAYLOAD_EXECUTABLE_EXTENSIONS", group: "Content check", label: "Executable extensions", type: "list", placeholder: "exe,scr,msi,apk", help: "If the largest file is one of these, the torrent is not what its name claims." },
    { key: "PAYLOAD_DELETE_FILES", group: "Content check", label: "Delete the files of a fake release", type: "boolean" },
    { key: "STALL_MINUTES", group: "Content check", label: "Give up after standing still (minutes)", type: "number", placeholder: "60", help: "Any progress at all restarts the clock, so a slow download is safe." },
    { key: "STALL_DELETE_FILES", group: "Content check", label: "Delete the files of a stalled release", type: "boolean" },
    { key: "BLOCKED_RELEASE_TTL_DAYS", group: "Content check", label: "Retry a stalled release after (days)", type: "number", placeholder: "30", help: "0 = never. A fake payload is blocked for good regardless." },

    // Notifications
    { key: "TELEGRAM_BOT_TOKEN", group: "Notifications", label: "Telegram bot token", type: "string", secret: true, help: "From @BotFather." },
    { key: "TELEGRAM_CHAT_ID", group: "Notifications", label: "Chat id", type: "string", help: "Negative for a group. It changes if Telegram turns the group into a supergroup." },
    { key: "TELEGRAM_EVENTS", group: "Notifications", label: "Events to send", type: "list", placeholder: "ready,started,dropped", help: "Empty sends nothing, * sends everything." },
    { key: "TELEGRAM_API_URL", group: "Notifications", label: "Bot API URL", type: "string", help: "Only for a self hosted Bot API server." },

    // Download dialog
    { key: "DOWNLOAD_OPTION_COUNT", group: "Download dialog", label: "Releases to offer", type: "number", placeholder: "5" },
    { key: "DOWNLOAD_PLAN_TTL_MINUTES", group: "Download dialog", label: "Search result kept for (minutes)", type: "number", placeholder: "15" }
];

export const SETTING_GROUPS = [ ...new Set(SETTINGS.map(def => def.group)) ];

const byKey = new Map(SETTINGS.map(def => [ def.key, def ]));

export const settingDef = (key: string) => byKey.get(key);

export const isSecret = (key: string) => !! byKey.get(key)?.secret;

// short: a save updates the map in place, so this only matters for another process
const CACHE_MS = 30 * 1000;

type Cache = { values: Map<string, string>, loadedAt: number };

// on global so hot reload does not drop it
const globalForSettings = global as unknown as { settings: Cache };
const cache: Cache = globalForSettings.settings || { values: new Map<string, string>(), loadedAt: 0 };
globalForSettings.settings = cache;

export const loadSettings = async (force = false) => {
    if (! force && Date.now() - cache.loadedAt < CACHE_MS) {
        return;
    }

    try {
        const rows = await prisma.setting.findMany();

        cache.values = new Map(rows.map(row => [ row.key, row.value ]));
        cache.loadedAt = Date.now();

    } catch(err) {
        // the env still answers every key, so this is stale rather than broken
        console.error(err);
    }
};

/**
 * An empty override is not a value, it is the absence of one: the row is deleted on
 * save, and anything left empty here means "whatever the env says".
 */
const raw = (key: string): string | undefined => {
    const own = cache.values.get(key);

    if (own !== undefined && own.trim() !== "") {
        return own;
    }

    const fromEnv = process.env[key];

    return fromEnv !== undefined && fromEnv.trim() !== "" ? fromEnv : undefined;
};

export const settingText = (key: string, fallback = "") => (raw(key) ?? fallback).trim();

export const settingNumber = (key: string, fallback: number) => {
    const value = Number(raw(key));

    return Number.isFinite(value) ? value : fallback;
};

export const settingFlag = (key: string, fallback: boolean) => {
    const value = raw(key);

    if (value === undefined) {
        return fallback;
    }

    return value.trim() === "1" || value.trim().toLowerCase() === "true";
};

/**
 * No fallback on purpose: an unset list means the rule it belongs to is off, which is
 * the safe direction. See the payload extensions.
 */
export const settingList = (key: string) => (raw(key) || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);

export const hasSetting = (key: string) => raw(key) !== undefined;

/** Where the effective value comes from, which is what the admin page shows. */
export const settingSource = (key: string): "database" | "env" | "unset" => {
    const own = cache.values.get(key);

    if (own !== undefined && own.trim() !== "") {
        return "database";
    }

    const fromEnv = process.env[key];

    return fromEnv !== undefined && fromEnv.trim() !== "" ? "env" : "unset";
};

/**
 * Saving. An empty value removes the override rather than storing emptiness, so the
 * admin page's "clear this field" is the same gesture as "go back to the env".
 */
export const saveSettings = async (values: Record<string, string>) => {
    const changed: string[] = [];

    for (const [ key, value ] of Object.entries(values)) {
        if (! byKey.has(key)) {
            continue;
        }

        const trimmed = (value ?? "").trim();

        if (trimmed === "") {
            await prisma.setting.deleteMany({ where: { key } });

        } else {
            await prisma.setting.upsert({
                where: { key },
                update: { value: trimmed },
                create: { key, value: trimmed }
            });
        }

        changed.push(key);
    }

    await loadSettings(true);

    return changed;
};
