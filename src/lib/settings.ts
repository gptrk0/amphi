import { prisma } from "@/lib/prisma";

/**
 * Every setting the app has, and the one place that knows how to read one.
 *
 * **Where a value comes from.** The `Setting` table, and nothing else — the environment
 * is not consulted. A key with no row falls back to the `default` written here, which is
 * the only copy of it: no call site carries a fallback of its own, so there is exactly
 * one place to look up what an unconfigured install does. Anything install specific — a
 * URL, a password, a chat id — deliberately has no default and reads as "not set" until
 * somebody fills it in on the admin page.
 *
 * **Clearing versus emptying.** For a list, empty is a decision: an empty payload
 * extension list means that rule is off. So an empty value is stored for a list and the
 * default is only restored by deleting the row, which is what the reset button does. For
 * everything else empty cannot mean anything useful — an empty torrent category would
 * let the scanner see every torrent in the client — so it deletes the row and the
 * default takes over again.
 *
 * **Why the read is synchronous.** `getQualityProfile()` and friends are called inside
 * scoring loops and cannot await per value, exactly like the blocklist. So the table is
 * pulled into a map and read from memory. Since the env is gone, a cold cache is no
 * longer merely stale — it would answer with defaults for keys that are configured —
 * hence `loadSettings()` at server start in `instrumentation.ts`, before anything is
 * served, and again on the way into every outward call and every scan round.
 */

/**
 * Thrown when something is asked of a service nobody has configured yet. Worth its own
 * type so an api route can answer with the reason and a 400 instead of a 500: on a fresh
 * install this is the normal case, not a failure.
 */
export class NotConfiguredError extends Error {
    constructor(what: string, group: string) {
        super(`${ what } is not configured — fill it in under Settings / ${ group }.`);

        this.name = "NotConfiguredError";
    }
}

export type SettingType = "string" | "number" | "boolean" | "list" | "table";

export type SettingDef = {
    key: string;
    group: string;
    label: string;
    type: SettingType;
    // what an install with no row for this key does. Absent = the key is install
    // specific and there is nothing sensible to guess
    default?: string;
    // a secret is never sent to the browser — it can be replaced, not read back
    secret?: boolean;
    // for a list whose order carries meaning, so the ui offers to reorder it
    ordered?: boolean;
    help?: string;
    placeholder?: string;
};

/**
 * Deliberately not here: `DATABASE_*` and `APP_*` (needed to reach this table in the
 * first place), and `SCAN_DISABLED` — an emergency brake belongs somewhere the app
 * cannot talk itself out of. Those four are the only environment variables left.
 */
export const SETTINGS: SettingDef[] = [
    // TMDB
    { key: "TMDB_API_KEY", group: "TMDB", label: "API key", type: "string", secret: true, help: "Everything on the discover pages comes from TMDB, so this is the one setting the app cannot start working without." },
    { key: "TMDB_LANGUAGE", group: "TMDB", label: "Language", type: "string", default: "en-US", help: "Also decides which titles the indexer search falls back to." },
    { key: "TMDB_REGION", group: "TMDB", label: "Region", type: "string", placeholder: "US", help: "Whose age rating to show. Taken from the language when empty." },
    { key: "TMDB_CACHE_TTL_MINUTES", group: "TMDB", label: "Metadata cache (minutes)", type: "number", default: "720" },
    { key: "DISCOVER_CACHE_TTL_MINUTES", group: "TMDB", label: "Discover row cache (minutes)", type: "number", default: "60", help: "Trending moves faster than metadata, so it gets its own, shorter cache." },

    // Indexers
    { key: "INDEXER_URL", group: "Indexers", label: "Jackett / Prowlarr URL", type: "string", placeholder: "http://host:9117" },
    { key: "INDEXER_API_KEY", group: "Indexers", label: "API key", type: "string", secret: true },
    { key: "INDEXER_IDS", group: "Indexers", label: "Indexers", type: "list", ordered: true, default: "all", placeholder: "indexer id", help: "Queried one by one, by capability, and the order is also the priority. `all` uses Jackett's aggregate endpoint, which silently drops any indexer that cannot search by imdb id — naming them is better." },
    { key: "INDEXER_PRIORITY", group: "Indexers", label: "Priority order", type: "list", ordered: true, help: "Only if it should differ from the order above." },
    { key: "INDEXER_PRIORITY_BONUS", group: "Indexers", label: "Priority weight", type: "number", default: "100000", help: "High enough and the preferred indexer always wins at equal resolution; lower it and the seeder count can decide." },
    { key: "INDEXER_CAPS_TTL_MINUTES", group: "Indexers", label: "Capability cache (minutes)", type: "number", default: "360" },

    // Torrent client
    { key: "TORRENT_URL", group: "Torrent client", label: "qBittorrent URL", type: "string", placeholder: "http://host:8080" },
    { key: "TORRENT_USER", group: "Torrent client", label: "User", type: "string" },
    { key: "TORRENT_PASS", group: "Torrent client", label: "Password", type: "string", secret: true },
    { key: "TORRENT_CATEGORY", group: "Torrent client", label: "Category", type: "string", default: "aioseerr", help: "Everything this app manages carries it, and nothing outside it is ever touched." },
    { key: "TORRENT_MOVIE_PATH", group: "Torrent client", label: "Film save path", type: "string", help: "As qBittorrent sees it. Empty leaves the destination to the category." },
    { key: "TORRENT_SERIES_PATH", group: "Torrent client", label: "Series save path", type: "string" },

    // Library
    { key: "LIBRARY_SEED_DAYS", group: "Library", label: "Seed for (days)", type: "number", default: "3", help: "A finished download cannot be deleted until this is up — it can be marked for deletion, and goes by itself when the time comes. The torrent keeps seeding afterwards until you delete it. 0 makes everything deletable at once." },

    // Quality
    { key: "QUALITY_RESOLUTIONS", group: "Quality", label: "Resolutions, best first", type: "list", ordered: true, default: "1080p,720p,2160p", help: "Anything not listed is rejected. An unrecognised resolution is kept as a last resort." },
    { key: "QUALITY_PREFERRED_CODECS", group: "Quality", label: "Preferred codecs", type: "list", ordered: true, default: "x264,h264,avc", help: "h264 plays on everything; hevc and av1 are the fallback." },
    { key: "QUALITY_CODEC_BONUS", group: "Quality", label: "Codec bonus", type: "number", default: "500", help: "Worth this many seeders." },
    { key: "QUALITY_MIN_SEEDERS", group: "Quality", label: "Minimum seeders", type: "number", default: "1" },
    { key: "QUALITY_MAX_SIZE_GB", group: "Quality", label: "Maximum size (GB)", type: "number", default: "0", help: "0 = no limit." },
    { key: "QUALITY_MAX_PACK_SIZE_PER_EPISODE_GB", group: "Quality", label: "Season pack ceiling per episode (GB)", type: "number", default: "5", help: "A 2160p pack can run to 89–189 GB, which is what this is for." },
    { key: "QUALITY_EXCLUDE", group: "Quality", label: "Excluded keywords", type: "list", default: "cam,camrip,hdcam,ts,telesync,hdts,telecine,tc,workprint,screener,scr,exe,msi,apk", help: "Matched on word boundaries, so 'ts' does not hit random words." },
    { key: "QUALITY_MIN_SIZE_MOVIE", group: "Quality", label: "Minimum film size per resolution", type: "table", default: "2160p:8,1080p:2,720p:0.8,480p:0.3", help: "A file this much smaller than the resolution it claims is not that video. GB per entry." },
    { key: "QUALITY_MIN_SIZE_EPISODE", group: "Quality", label: "Minimum episode size per resolution", type: "table", default: "2160p:1.5,1080p:0.4,720p:0.15,480p:0.05" },

    // Language is not here any more: it is on the account page, one set per person.
    // Two people wanting the same film in different languages get two downloads, and a
    // single house-wide list could not express that. See src/lib/language.ts.

    // Scanner
    { key: "WATCHLIST_SCAN_INTERVAL_MINUTES", group: "Scanner", label: "Scan every (minutes)", type: "number", default: "15" },
    { key: "DOWNLOAD_SYNC_INTERVAL_MINUTES", group: "Scanner", label: "Read the client back every (minutes)", type: "number", default: "1" },
    { key: "SEARCH_BACKOFF_MINUTES", group: "Scanner", label: "First wait after an empty search (minutes)", type: "number", default: "30", help: "Doubles with every fruitless search. Nothing is ever given up on." },
    { key: "SEARCH_MAX_BACKOFF_HOURS", group: "Scanner", label: "Longest wait (hours)", type: "number", default: "24" },
    { key: "EPISODE_SEARCH_CONCURRENCY", group: "Scanner", label: "Parallel episode searches", type: "number", default: "3" },
    { key: "SCAN_DRY_RUN", group: "Scanner", label: "Dry run", type: "boolean", default: "0", help: "On: the scanner only logs what it would grab. Manual downloads are always real." },

    // Content check
    { key: "PAYLOAD_VIDEO_EXTENSIONS", group: "Content check", label: "Video extensions", type: "list", default: "mkv,mp4,avi,m4v,mpg,mpeg,ts,m2ts,mts,wmv,mov,flv,webm,vob,ogm,divx,iso,img", help: "Emptying this turns the rule off — it cannot mean 'nothing is a video', that would delete every torrent. `*` accepts everything." },
    { key: "PAYLOAD_ARCHIVE_EXTENSIONS", group: "Content check", label: "Archive extensions", type: "list", default: "rar,zip,7z,tar,gz,bz2,001", help: "An archived release cannot be judged from a file list, so it is never called bad. .r00-.r99 follow 'rar'." },
    { key: "PAYLOAD_EXECUTABLE_EXTENSIONS", group: "Content check", label: "Executable extensions", type: "list", default: "exe,scr,msi,bat,cmd,com,apk,lnk,vbs,js,jse,wsf,ps1,jar,dmg,pkg,deb,reg,hta,pif", help: "If the largest file is one of these, the torrent is not what its name claims." },
    { key: "PAYLOAD_DELETE_FILES", group: "Content check", label: "Delete the files of a fake release", type: "boolean", default: "1" },
    { key: "STALL_MINUTES", group: "Content check", label: "Give up after standing still (minutes)", type: "number", default: "60", help: "Any progress at all restarts the clock, so a slow download is safe." },
    { key: "STALL_DELETE_FILES", group: "Content check", label: "Delete the files of a stalled release", type: "boolean", default: "1" },
    { key: "BLOCKED_RELEASE_TTL_DAYS", group: "Content check", label: "Retry a stalled release after (days)", type: "number", default: "30", help: "0 = never. A fake payload is blocked for good regardless." },

    // Notifications
    { key: "TELEGRAM_BOT_TOKEN", group: "Notifications", label: "Telegram bot token", type: "string", secret: true, help: "From @BotFather." },
    { key: "TELEGRAM_CHAT_ID", group: "Notifications", label: "Chat id", type: "string", help: "Message the bot once, then read it from /getUpdates. Negative for a group, and it changes if Telegram turns that group into a supergroup." },
    { key: "TELEGRAM_EVENTS", group: "Notifications", label: "Events to send", type: "list", default: "ready,started,dropped", help: "ready = a download finished and is watchable, started = the scanner grabbed something, dropped = a grab turned out to be fake or dead. Empty sends nothing, `*` sends everything." },
    { key: "TELEGRAM_API_URL", group: "Notifications", label: "Bot API URL", type: "string", default: "https://api.telegram.org", help: "Only for a self hosted Bot API server." },
    { key: "NOTIFY_WEBHOOK_ALLOW_PRIVATE", group: "Notifications", label: "Allow webhooks inside your network", type: "boolean", default: "0", help: "Everybody here can set a webhook of their own on their account page, and the server is what calls it — so by default it refuses addresses only the server can reach (localhost, 10.x, 192.168.x). Turn this on only if somebody genuinely has a receiver on the same network." },

    // Download dialog
    { key: "DOWNLOAD_OPTION_COUNT", group: "Download dialog", label: "Releases to offer", type: "number", default: "5" },
    { key: "DOWNLOAD_PLAN_TTL_MINUTES", group: "Download dialog", label: "Search result kept for (minutes)", type: "number", default: "15", help: "How long the search behind an open dialog is kept, so answering it does not search again." },

    // Access
    { key: "AUTH_SESSION_DAYS", group: "Access", label: "Stay signed in for (days)", type: "number", default: "30", help: "Counted from the last request, not from the login, so somebody who uses the app never gets thrown out. 0 = never expires, until somebody signs out or the account is switched off. Shortening this reaches the sessions that are already open." },
    { key: "AUTH_ALLOW_PASSWORD", group: "Access", label: "Allow the password form", type: "boolean", default: "1", help: "Off leaves single sign-on as the only way in — and is ignored while no provider is configured, so this cannot be the setting that locks you out." },
    { key: "AUTH_PUBLIC_URL", group: "Access", label: "Public address of this app", type: "string", placeholder: "https://aioseerr.example.com", help: "Only needed for single sign-on behind a proxy that does not send X-Forwarded-Host: it is what the redirect back from the provider is built from." },
    { key: "AUTH_OIDC_ENABLED", group: "Access", label: "Single sign-on", type: "boolean", default: "0", help: "OpenID Connect — Authentik, Authelia, Keycloak, Google. The provider is asked what its endpoints are, so the issuer below is all it needs." },
    { key: "AUTH_OIDC_NAME", group: "Access", label: "Name of the provider", type: "string", default: "Single sign-on", help: "What the button on the login page says." },
    { key: "AUTH_OIDC_ISSUER", group: "Access", label: "Issuer URL", type: "string", placeholder: "https://auth.example.com/application/o/aioseerr/", help: "Authentik prints it on the provider page. Everything else is read from its .well-known/openid-configuration." },
    { key: "AUTH_OIDC_CLIENT_ID", group: "Access", label: "Client id", type: "string" },
    { key: "AUTH_OIDC_CLIENT_SECRET", group: "Access", label: "Client secret", type: "string", secret: true, help: "Leave empty for a public client — the flow uses PKCE either way." },
    { key: "AUTH_OIDC_SCOPES", group: "Access", label: "Scopes", type: "list", default: "openid,profile,email", help: "Add the one that carries the groups claim if you map admins by group below." },
    { key: "AUTH_OIDC_AUTO_CREATE", group: "Access", label: "Create an account on first sign-in", type: "boolean", default: "1", help: "On: whoever the provider lets through gets an account here, as a plain user. Off: only somebody already on the users page can sign in." },
    { key: "AUTH_OIDC_GROUPS_CLAIM", group: "Access", label: "Groups claim", type: "string", default: "groups" },
    { key: "AUTH_OIDC_ADMIN_GROUPS", group: "Access", label: "Groups that make an admin", type: "list", help: "While this is filled in, the provider decides the role of every account it signs in — being removed from the group takes admin away again. It can never take away the last admin, so a typo here cannot lock you out." },

    // Log
    { key: "LOG_RETENTION_DAYS", group: "Log", label: "Keep entries for (days)", type: "number", default: "14", help: "0 = keep everything. Checked once an hour, on the way out of a write." },
    { key: "LOG_DEBUG", group: "Log", label: "Keep debug entries", type: "boolean", default: "0", help: "Every indexer search and every preview, which is a lot of lines — worth turning on while something is being chased down." }
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
        // nothing else answers these keys, so this is worth being loud about
        console.error("[settings] could not be read, falling back to the defaults", err);
    }
};

/**
 * A row wins even when it is empty: for a list that is the difference between "off" and
 * "not decided yet". Keys that cannot mean anything empty never get an empty row in the
 * first place — see `saveSettings`.
 */
const raw = (key: string): string | undefined => {
    const own = cache.values.get(key);

    return own !== undefined ? own : byKey.get(key)?.default;
};

export const settingText = (key: string) => (raw(key) ?? "").trim();

export const settingNumber = (key: string) => {
    const value = Number(raw(key));

    if (Number.isFinite(value)) {
        return value;
    }

    // a hand typed nonsense value must not turn a scan interval into 0
    const fromDefault = Number(byKey.get(key)?.default);

    return Number.isFinite(fromDefault) ? fromDefault : 0;
};

export const settingFlag = (key: string) => {
    const value = (raw(key) ?? "").trim().toLowerCase();

    return value === "1" || value === "true";
};

export const settingList = (key: string) => (raw(key) || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);

export const hasSetting = (key: string) => settingText(key) !== "";

/** Where the effective value comes from, which is what the admin page shows. */
export const settingSource = (key: string): "database" | "default" | "unset" => {
    if (cache.values.get(key) !== undefined) {
        return "database";
    }

    return byKey.get(key)?.default !== undefined ? "default" : "unset";
};

/**
 * Saving. An empty value stores an empty row for a list, because an empty list is a
 * decision, and deletes the row for everything else, because an empty number or an empty
 * category is not one. Either way `deleteSetting` is how a key goes back to its default.
 */
export const saveSettings = async (values: Record<string, string>) => {
    const changed: string[] = [];

    for (const [ key, value ] of Object.entries(values)) {
        const def = byKey.get(key);

        if (! def) {
            continue;
        }

        const trimmed = (value ?? "").trim();
        const keepsEmpty = def.type === "list" || def.type === "table";

        if (trimmed === "" && ! keepsEmpty) {
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

/** Back to the default, which is a different gesture from saving an empty value. */
export const deleteSetting = async (key: string) => {
    if (! byKey.has(key)) {
        return false;
    }

    await prisma.setting.deleteMany({ where: { key } });
    await loadSettings(true);

    return true;
};
