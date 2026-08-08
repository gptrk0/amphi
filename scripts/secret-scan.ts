/**
 * Reads a diff on stdin and says whether any real secret is in it. The values come from
 * the `Setting` table and are never printed — only the key name and a verdict.
 *
 * Since the settings moved out of the env, `grep`-ing the diff for `.env` values is not
 * enough any more: the tokens now live in the database.
 *
 *   git diff --cached | docker exec -i aioseerr_app bun scripts/secret-scan.ts
 */

import { prisma } from "../src/lib/prisma";
import { SETTINGS } from "../src/lib/settings";

const diff = await Bun.stdin.text();

if (diff.trim() === "") {
    console.log("nothing on stdin — did you forget to pipe a diff in?");
    process.exit(1);
}

const rows = await prisma.setting.findMany();

// a short value would hit by accident (a port, a `1`), so only what is long enough to be
// a credential is worth searching for
const worth = rows.filter(row => row.value.trim().length >= 8);
const leaked: string[] = [];

for (const row of worth) {
    const secret = !! SETTINGS.find(def => def.key === row.key)?.secret;

    if (! diff.includes(row.value)) {
        console.log(`clean ${ row.key }`);
        continue;
    }

    // a credential in a diff is a mistake; a URL or an indexer name in the docs can be a
    // choice, so only the first kind fails the scan
    if (secret) {
        leaked.push(row.key);
        console.log(`LEAK  ${ row.key } (secret)`);

    } else {
        console.log(`note  ${ row.key } appears in the diff — check that you meant it`);
    }
}

console.log(`\n${ worth.length } value${ worth.length === 1 ? "" : "s" } checked, ${ diff.length } characters of diff`);

if (leaked.length > 0) {
    console.log(`do not commit: ${ leaked.join(", ") }`);
    process.exit(1);
}

await prisma.$disconnect();
