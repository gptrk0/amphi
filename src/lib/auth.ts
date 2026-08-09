import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";

import { User, UserRole } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/cookies";
import { verifyPassword } from "@/lib/password";
import { loadSettings, settingFlag, settingNumber, settingText } from "@/lib/settings";

/**
 * Who is asking, and whether they may.
 *
 * **Why no library.** Everything this app is configured with lives in the `Setting`
 * table and can be changed from the admin page without a restart — including the
 * identity provider. A session library wants its providers and its secret from the
 * environment at import time, which is the one thing this codebase decided not to do.
 * A signed in browser is a random token and a row, and that is the whole mechanism.
 *
 * **Why there is no secret to keep.** The cookie carries the token, the table holds
 * its SHA-256. Nothing is signed, so nothing has to be seeded, and a database that
 * leaks is not a pile of working sessions.
 */

export { SESSION_COOKIE };

export type AuthUser = {
    id: number;
    email: string;
    name: string;
    role: UserRole;
    isAdmin: boolean;
    /// whether this account can be signed into with a password at all
    hasPassword: boolean;
    linkedToProvider: boolean;
};

export const toAuthUser = (user: User): AuthUser => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isAdmin: user.role === UserRole.ADMIN,
    hasPassword: !! user.passwordHash,
    linkedToProvider: !! user.oidcSubject
});

/**
 * How long a signed in browser stays signed in, with **0 meaning never expire**.
 *
 * The column is not nullable and there is no "no expiry" to store, so forever is a
 * date a century out. It is not a magic value anything compares against — the setting
 * is what decides, and this only has to be further away than anybody will be here.
 */
const sessionDays = () => Math.max(settingNumber("AUTH_SESSION_DAYS"), 0);

const isForever = () => sessionDays() === 0;

const FOREVER_MS = 100 * 365 * 24 * 60 * 60 * 1000;

// browsers cap a cookie's own lifetime at about four hundred days whatever is asked
// for, so a "forever" session is renewed by the visit rather than by the number
const COOKIE_CAP = 400 * 24 * 60 * 60;

const sessionWindowMs = () => isForever() ? FOREVER_MS : sessionDays() * 24 * 60 * 60 * 1000;

const cookieMaxAge = () => isForever() ? COOKIE_CAP : sessionDays() * 24 * 60 * 60;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Whether the browser reached us over TLS, which decides the `Secure` flag. Behind a
 * proxy only the forwarded header knows — and marking a cookie `Secure` on a plain
 * http install would mean the browser never sends it back and nobody can sign in.
 */
const isHttps = async () => {
    const header = await headers();
    const proto = header.get("x-forwarded-proto") || "";

    return proto.split(",")[0].trim() === "https";
};

export const sessionCookieOptions = async (maxAge: number) => ({
    httpOnly: true,
    // Lax and not Strict: the return leg of a single sign-on is a top level navigation
    // from another site, and Strict would drop the cookie exactly there
    sameSite: "lax" as const,
    secure: await isHttps(),
    path: "/",
    maxAge
});

/** A new signed in browser. Returns the token; the caller decides how it is sent. */
export const createSession = async (userId: number) => {
    const token = randomBytes(32).toString("base64url");

    await prisma.session.create({
        data: {
            id: tokenHash(token),
            userId,
            expiresAt: new Date(Date.now() + sessionWindowMs())
        }
    });

    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

    return { token, maxAge: cookieMaxAge() };
};

export const startSession = async (userId: number) => {
    const { token, maxAge } = await createSession(userId);
    const store = await cookies();

    store.set(SESSION_COOKIE, token, await sessionCookieOptions(maxAge));

    return token;
};

export const endSession = async () => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;

    if (token) {
        await prisma.session.deleteMany({ where: { id: tokenHash(token) } });
    }

    store.set(SESSION_COOKIE, "", await sessionCookieOptions(0));
};

/** Every browser of one account, which is what disabling or a password change ends. */
export const endAllSessions = async (userId: number) => {
    return await prisma.session.deleteMany({ where: { userId } });
};

/**
 * The signed in user, or null. The window slides on use: past the halfway mark the
 * expiry is pushed out again, so somebody who opens the app every day is never signed
 * out and somebody who stops using it eventually is.
 *
 * It also slides **down**. Shortening the setting — or turning "never" back into
 * thirty days — has to reach the sessions that are already out there, or the change
 * would only apply to people who sign in again afterwards, which is nobody.
 */
export const currentUser = async (): Promise<AuthUser | null> => {
    // the session length is read synchronously below, and this runs on every guarded
    // request — so this is the "on the way in" the settings cache is designed around
    await loadSettings();

    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;

    if (! token) {
        return null;
    }

    const session = await prisma.session.findUnique({
        where: { id: tokenHash(token) },
        include: { user: true }
    });

    if (! session) {
        return null;
    }

    if (session.expiresAt.getTime() <= Date.now() || session.user.disabled) {
        await prisma.session.deleteMany({ where: { id: session.id } });

        return null;
    }

    // The rule is on what is left, not on how long ago the last visit was, and that is
    // what makes a changed setting reach the sessions that are already out there: a
    // window that shrank leaves too much on them, one that grew leaves too little.
    const window = sessionWindowMs();
    const left = session.expiresAt.getTime() - Date.now();

    if (left < window / 2 || left > window) {
        await prisma.session.update({
            where: { id: session.id },
            data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + window) }
        });
    }

    return toAuthUser(session.user);
};

/**
 * A fresh install has nobody in it, and until it does the only page that answers is
 * the one that creates the first administrator. Whoever reaches the app first claims
 * it — the same bargain every self hosted thing makes on its first run, which is why
 * this window closes the moment one account exists.
 */
export const needsSetup = async () => await prisma.user.count() === 0;

const refuse = (message: string, status: number) => {
    return Response.json({ success: false, message }, { status });
};

/**
 * The guards. They answer with the refusal rather than throwing, because a route that
 * forgets to catch would turn "you are not signed in" into a 500 — and because reading
 * `if (refusal) return refusal` at the top of a handler is the whole story.
 */
export const refuseUnlessSignedIn = async (): Promise<Response | null> => {
    const user = await currentUser();

    if (! user) {
        return refuse("Sign in first.", 401);
    }

    return null;
};

export const refuseUnlessAdmin = async (): Promise<Response | null> => {
    const user = await currentUser();

    if (! user) {
        return refuse("Sign in first.", 401);
    }

    if (! user.isAdmin) {
        return refuse("That is for administrators.", 403);
    }

    return null;
};

/**
 * Who did this, for the log. Every line the scheduler did not write is somebody's, and
 * on a shared watchlist that is the only record of whose idea it was.
 *
 * The name and not the address, because this is read by a person. It is required on an
 * account for exactly this reason.
 */
export const actorText = (user: AuthUser | null) => {
    return user ? `by ${ user.name }` : "by nobody signed in";
};

/** The same, glued onto whatever else the line had to say. */
export const withActor = (detail: string | undefined, user: AuthUser | null) => {
    return detail ? `${ detail } — ${ actorText(user) }` : actorText(user);
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const findUserByEmail = async (email: string) => {
    return await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
};

/**
 * Password sign-in. A missing account still costs a hash comparison, so the answer
 * takes the same time either way and the form cannot be used to find out which
 * addresses have accounts.
 */
export const signInWithPassword = async (email: string, password: string) => {
    const user = await findUserByEmail(email);
    const ok = await verifyPassword(password, user?.passwordHash ?? null);

    if (! user || ! ok || user.disabled || ! user.passwordHash) {
        return null;
    }

    return user;
};

/**
 * Whether the password form is offered at all. Turning it off only counts while there
 * is another way in — otherwise the setting would be a lock with the key inside.
 */
export const passwordLoginAllowed = () => {
    return settingFlag("AUTH_ALLOW_PASSWORD") || ! oidcConfigured();
};

export const oidcConfigured = () => {
    return settingFlag("AUTH_OIDC_ENABLED")
        && settingText("AUTH_OIDC_ISSUER") !== ""
        && settingText("AUTH_OIDC_CLIENT_ID") !== "";
};

/** Same shape as `timingSafeEqual` wants, for comparing an oauth state to its cookie. */
export const sameToken = (left: string, right: string) => {
    const a = Buffer.from(left);
    const b = Buffer.from(right);

    return a.length === b.length && timingSafeEqual(a, b);
};
