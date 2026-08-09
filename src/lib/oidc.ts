import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";

import { User, UserRole } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { STATE_COOKIE } from "@/lib/cookies";
import { NotConfiguredError, settingFlag, settingList, settingText } from "@/lib/settings";

/**
 * An OpenID Connect client, by hand, in one file.
 *
 * **The flow** is authorization code with PKCE. The provider is asked for its own
 * endpoints (`.well-known/openid-configuration`), so an install only has to be told
 * the issuer — which is exactly what Authentik prints on its provider page.
 *
 * **Why the claims come from userinfo and not from the id_token.** Verifying an
 * id_token means fetching the provider's JWKS, matching the key id, and checking an
 * RS256 signature — a dependency and a lot of ways to be subtly wrong. The token
 * response was fetched by this server, from the token endpoint, over TLS, with a code
 * that only this server had the verifier for; the identity in it does not need a
 * signature to be trustworthy, because nobody else was in the conversation. The same
 * argument covers `userinfo`, which is fetched the same way. So the id_token is
 * decoded only for the claims userinfo does not return.
 *
 * **What binds the two legs together** is the `state`, which is generated here, put
 * in a short lived cookie, and compared on the way back. That is what stops somebody
 * feeding this app a code they obtained for their own account.
 */

export type OidcProfile = {
    subject: string;
    email: string;
    name: string;
    groups: string[];
};

type Discovery = {
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint?: string;
    end_session_endpoint?: string;
};

export { STATE_COOKIE };

const globalForOidc = global as unknown as {
    oidcDiscovery: { issuer: string, at: number, document: Discovery } | null
};

const issuer = () => settingText("AUTH_OIDC_ISSUER").replace(/\/+$/, "");

const clientId = () => settingText("AUTH_OIDC_CLIENT_ID");

const clientSecret = () => settingText("AUTH_OIDC_CLIENT_SECRET");

const scopes = () => {
    const list = settingList("AUTH_OIDC_SCOPES");

    // openid is what makes it OpenID Connect rather than plain oauth, so it is not
    // something a hand edited list gets to leave out
    return [ ...new Set([ "openid", ...list ]) ].join(" ");
};

export const providerName = () => settingText("AUTH_OIDC_NAME") || "Single sign-on";

export const isOidcEnabled = () => {
    return settingFlag("AUTH_OIDC_ENABLED") && issuer() !== "" && clientId() !== "";
};

const requireOidc = () => {
    if (! isOidcEnabled()) {
        throw new NotConfiguredError("Single sign-on", "Access");
    }
};

/**
 * Cached for ten minutes and re-fetched when the issuer changes, so editing the
 * setting takes effect on the next attempt rather than on the next restart.
 */
const discover = async (): Promise<Discovery> => {
    const url = issuer();
    const cached = globalForOidc.oidcDiscovery;

    if (cached && cached.issuer === url && Date.now() - cached.at < 10 * 60 * 1000) {
        return cached.document;
    }

    const res = await fetch(`${ url }/.well-known/openid-configuration`, { cache: "no-store" });

    if (! res.ok) {
        throw new Error(`the provider did not describe itself (${ res.status } from ${ url })`);
    }

    const document = await res.json() as Discovery;

    if (! document.authorization_endpoint || ! document.token_endpoint) {
        throw new Error("the provider's configuration has no authorization or token endpoint");
    }

    globalForOidc.oidcDiscovery = { issuer: url, at: Date.now(), document };

    return document;
};

/**
 * Where the provider is told to send the browser back to. It has to match what is
 * registered on the provider **exactly**, so it is worth being able to override: a
 * proxy that rewrites the host without saying so would otherwise build an address
 * nobody registered.
 */
export const redirectUri = async () => {
    const configured = settingText("AUTH_PUBLIC_URL");

    if (configured) {
        return `${ configured.replace(/\/+$/, "") }/api/auth/oidc/callback`;
    }

    const header = await headers();
    const host = header.get("x-forwarded-host") || header.get("host") || "localhost:3000";
    const proto = (header.get("x-forwarded-proto") || "http").split(",")[0].trim();

    return `${ proto }://${ host }/api/auth/oidc/callback`;
};

const base64url = (value: Buffer) => value.toString("base64url");

/** The authorize url, plus the two secrets that have to survive until the way back. */
export const beginLogin = async () => {
    requireOidc();

    const document = await discover();
    const state = base64url(randomBytes(24));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash("sha256").update(verifier).digest());

    const url = new URL(document.authorization_endpoint);

    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId());
    url.searchParams.set("redirect_uri", await redirectUri());
    url.searchParams.set("scope", scopes());
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    return { url: url.toString(), state, verifier };
};

type TokenResponse = { access_token?: string, id_token?: string, error?: string, error_description?: string };

const exchange = async (code: string, verifier: string): Promise<TokenResponse> => {
    const document = await discover();
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: await redirectUri(),
        client_id: clientId(),
        code_verifier: verifier
    });

    const sent: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    const secret = clientSecret();

    if (secret) {
        // basic is what a confidential client is expected to use; the id is sent in the
        // body as well, which every provider tolerates and some require
        sent.Authorization = `Basic ${ Buffer.from(`${ clientId() }:${ secret }`).toString("base64") }`;
    }

    const res = await fetch(document.token_endpoint, { method: "POST", headers: sent, body, cache: "no-store" });
    const json = await res.json().catch(() => ({})) as TokenResponse;

    if (! res.ok || ! json.access_token) {
        throw new Error(json.error_description || json.error || `the token exchange failed (${ res.status })`);
    }

    return json;
};

/** The payload of a JWT, unverified — see the note at the top of this file. */
const claimsOf = (token: string | undefined): Record<string, unknown> => {
    if (! token) {
        return {};
    }

    try {
        return JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());

    } catch {
        return {};
    }
};

const asList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === "string");
    }

    return typeof value === "string" && value ? [ value ] : [];
};

const text = (value: unknown) => typeof value === "string" ? value : "";

/** Everything the second leg needs: who signed in, and what they are a member of. */
export const finishLogin = async (code: string, verifier: string): Promise<OidcProfile> => {
    requireOidc();

    const token = await exchange(code, verifier);
    const document = await discover();
    const claims: Record<string, unknown> = { ...claimsOf(token.id_token) };

    if (document.userinfo_endpoint) {
        const res = await fetch(document.userinfo_endpoint, {
            headers: { Authorization: `Bearer ${ token.access_token }` },
            cache: "no-store"
        });

        if (res.ok) {
            Object.assign(claims, await res.json().catch(() => ({})));
        }
    }

    const subject = text(claims.sub);

    if (! subject) {
        throw new Error("the provider returned no subject, so there is nothing to recognise this account by next time");
    }

    const groupsClaim = settingText("AUTH_OIDC_GROUPS_CLAIM") || "groups";

    return {
        subject,
        email: text(claims.email).trim().toLowerCase(),
        name: text(claims.name) || text(claims.preferred_username) || text(claims.given_name),
        groups: asList(claims[groupsClaim])
    };
};

/**
 * What the provider's groups say this account should be — or null when nobody has
 * mapped any groups, which leaves the role alone and makes this a pure sign-in.
 */
const roleFromGroups = (groups: string[]) => {
    const admin = settingList("AUTH_OIDC_ADMIN_GROUPS");

    if (admin.length === 0) {
        return null;
    }

    const wanted = new Set(admin.map(entry => entry.toLowerCase()));

    return groups.some(group => wanted.has(group.toLowerCase())) ? UserRole.ADMIN : UserRole.USER;
};

export class OidcSignInError extends Error {}

/**
 * The account behind a provider profile.
 *
 * Matching goes by `sub` first and by address second — the address is how an account
 * somebody typed in on the users page gets adopted by the provider on its first sign
 * in, and after that the subject is what identifies it, because an address can be
 * given to somebody else and a subject cannot.
 */
export const userForProfile = async (profile: OidcProfile): Promise<User> => {
    const bySubject = await prisma.user.findUnique({ where: { oidcSubject: profile.subject } });
    const existing = bySubject
        || (profile.email ? await prisma.user.findUnique({ where: { email: profile.email } }) : null);

    const mapped = roleFromGroups(profile.groups);

    if (existing) {
        if (existing.disabled) {
            throw new OidcSignInError("That account is switched off here.");
        }

        // never on the way down for the last one: a group that was renamed at the
        // provider must not leave this install with nobody who can fix it
        const keepRole = mapped === UserRole.USER
            && existing.role === UserRole.ADMIN
            && await prisma.user.count({ where: { role: UserRole.ADMIN, disabled: false, id: { not: existing.id } } }) === 0;

        return await prisma.user.update({
            where: { id: existing.id },
            data: {
                oidcSubject: profile.subject,
                // an address that changed at the provider follows it here
                ...(profile.email && profile.email !== existing.email ? { email: profile.email } : {}),
                ...(! existing.name && profile.name ? { name: profile.name } : {}),
                ...(mapped && ! keepRole ? { role: mapped } : {})
            }
        });
    }

    if (! settingFlag("AUTH_OIDC_AUTO_CREATE")) {
        throw new OidcSignInError("You do not have an account on this install yet — an administrator has to add you.");
    }

    if (! profile.email) {
        throw new OidcSignInError("The provider sent no email address, so no account could be created. Add the email scope.");
    }

    // the very first person through the door is the administrator even without a group
    // mapping, because otherwise a fresh install signed into by its owner has nobody
    const first = await prisma.user.count() === 0;

    return await prisma.user.create({
        data: {
            email: profile.email,
            name: profile.name,
            oidcSubject: profile.subject,
            role: first ? UserRole.ADMIN : (mapped || UserRole.USER)
        }
    });
};
