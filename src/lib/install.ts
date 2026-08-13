import { prisma } from "@/lib/prisma";
import { loadSettings, settingText } from "@/lib/settings";

/**
 * Who this install is, in one short string.
 *
 * It exists for one reason. The tags this app writes into qBittorrent are how a torrent
 * is found again after it was handed over, and a tag built from a row id alone is only
 * unique inside one database. Point a second install at the same client — a development
 * one next to the real one — or recreate the database, and the ids start over while the
 * old tags stay on the old torrents. Then the lookup finds the stranger's torrent, the
 * row follows it from then on, and deleting the row would delete somebody else's files.
 * That is exactly what happened on 2026-08-11; see `libraryTag`.
 *
 * It lives in the `Setting` table but deliberately **not** in `SETTINGS`: it is not a
 * decision anybody makes, so it has no business on the settings page — and both
 * `saveSettings` and `deleteSetting` ignore a key the registry does not know, which is
 * the protection an identity wants. Written once and never again.
 */
const KEY = "INSTALL_ID";

// on global so hot reload does not ask the database again
const globalForInstall = global as unknown as { installId: string | null };

/**
 * Four random bytes as hex, from the Web Crypto global rather than `node:crypto`.
 *
 * Not a preference. A middleware exists, so next compiles `instrumentation.ts` for the edge
 * runtime too, and the imports from there reach this file — where `node:crypto` is a scheme
 * webpack has nothing to do with and the build stops. `crypto` is a global in node, in bun and
 * on the edge alike, so there is no module for a bundler to resolve in the first place.
 */
const randomId = () => {
    const bytes = new Uint8Array(4);

    crypto.getRandomValues(bytes);

    return Array.from(bytes).map(byte => byte.toString(16).padStart(2, "0")).join("");
};

export const installId = async (): Promise<string> => {
    if (globalForInstall.installId) {
        return globalForInstall.installId;
    }

    await loadSettings();

    const stored = settingText(KEY);

    if (stored) {
        globalForInstall.installId = stored;

        return stored;
    }

    const created = randomId();

    try {
        // `create`, not `upsert`: two grabs racing at the birth of an install must end up
        // with one identity, and the one that loses the unique key reads the winner's row
        // rather than writing its own over it
        await prisma.setting.create({ data: { key: KEY, value: created } });

    } catch {
        await loadSettings(true);

        const won = settingText(KEY);

        if (! won) {
            throw new Error("the install id could not be written, so nothing can be tagged in the client");
        }

        globalForInstall.installId = won;

        return won;
    }

    await loadSettings(true);

    globalForInstall.installId = created;

    return created;
};
