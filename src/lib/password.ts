import { randomBytes, scrypt as scryptCallback, ScryptOptions, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Passwords, with nothing added to package.json. `scrypt` ships with node and is a
 * memory hard function, which is the property that matters here: the whole point is
 * that a stolen hash cannot be run through a graphics card at speed.
 *
 * The stored form carries its own parameters — `scrypt$N$r$p$salt$hash` — so raising
 * the cost later does not invalidate what is already in the table. An old hash still
 * verifies against the numbers it was made with.
 */

// promisify picks the overload without options, and the options are the whole point
const scrypt = promisify(scryptCallback) as (
    password: string,
    salt: Buffer,
    keylen: number,
    options: ScryptOptions
) => Promise<Buffer>;

// ~64 MB and about a tenth of a second, which is the usual balance for a login form
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export const hashPassword = async (password: string) => {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });

    return [ "scrypt", N, R, P, salt.toString("base64"), key.toString("base64") ].join("$");
};

/**
 * False for anything unreadable rather than throwing: a truncated row in the database
 * has to mean "this password does not open the account", not a 500 on the login page.
 */
export const verifyPassword = async (password: string, stored: string | null) => {
    if (! stored) {
        return false;
    }

    const [ scheme, n, r, p, salt, hash ] = stored.split("$");

    if (scheme !== "scrypt" || ! salt || ! hash) {
        return false;
    }

    try {
        const expected = Buffer.from(hash, "base64");
        const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
            N: Number(n),
            r: Number(r),
            p: Number(p)
        });

        return timingSafeEqual(key, expected);

    } catch {
        return false;
    }
};

/**
 * The one rule, and it is a length rule. Composition rules push people towards
 * `Passw0rd!`, and this app is not guarding a bank — it is guarding a torrent client
 * behind somebody's router.
 */
export const passwordProblem = (password: string) => {
    if (password.length < 8) {
        return "The password has to be at least 8 characters.";
    }

    if (password.length > 200) {
        return "That password is too long.";
    }

    return null;
};
