/**
 * Two names, alone in a file with no imports. The middleware runs on the edge runtime
 * and only needs to know what the session cookie is called — importing that from
 * `auth.ts` would drag Prisma and node's crypto into a bundle that cannot have them.
 */

export const SESSION_COOKIE = "amphi_session";

/** Carries the oauth state and the PKCE verifier across the trip to the provider. */
export const STATE_COOKIE = "amphi_oidc";
