/**
 * One shot: brings whatever the environment still says about a setting into the
 * `Setting` table, which is the only place the app reads from now.
 *
 * Kept in the repo as the record of that move. Running it again is harmless — a key that
 * already has a row is never touched, so it cannot overwrite something edited since.
 *
 *   docker exec aioseerr_app bun scripts/import-env-settings.ts
 */

import { SETTINGS } from "../src/lib/settings";
import { prisma } from "../src/lib/prisma";

const rows = await prisma.setting.findMany();
const saved = new Set(rows.map(row => row.key));

const report: Record<string, string[]> = { imported: [], "already saved": [], "same as the default": [], "not in the env": [] };

for (const def of SETTINGS) {
    const value = (process.env[def.key] ?? "").trim();

    if (value === "") {
        report["not in the env"].push(def.key);
        continue;
    }

    if (saved.has(def.key)) {
        report["already saved"].push(def.key);
        continue;
    }

    // a row that only repeats the default is noise: the point of the table is to read
    // as the list of decisions somebody actually made
    if (value === (def.default ?? "")) {
        report["same as the default"].push(def.key);
        continue;
    }

    await prisma.setting.create({ data: { key: def.key, value } });

    report.imported.push(def.key);
}

for (const [ label, keys ] of Object.entries(report)) {
    console.log(`\n${ label } (${ keys.length })`);

    for (const key of keys) {
        console.log(`  ${ key }`);
    }
}

await prisma.$disconnect();
