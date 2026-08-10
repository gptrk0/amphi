import { NextRequest, NextResponse } from "next/server";

import { sessionCookieOptions } from "@/lib/auth";
import { errorText, logError } from "@/lib/log";
import { appUrl, beginLogin, STATE_COOKIE } from "@/lib/oidc";
import { loadSettings } from "@/lib/settings";

/**
 * The way out to the provider. The `state` and the PKCE verifier have to survive a
 * round trip through somebody else's website, so they ride in a short lived cookie of
 * their own — nowhere else would they be, since this app keeps no server side state
 * for a browser that has not signed in yet.
 *
 * Ten minutes, which is enough to type a password and answer a second factor, and
 * short enough that an abandoned attempt leaves nothing behind.
 */
export async function GET(req: NextRequest) {
    try {
        await loadSettings();

        const { url, state, verifier } = await beginLogin();
        const next = req.nextUrl.searchParams.get("next") || "/";

        const response = NextResponse.redirect(url);

        response.cookies.set(STATE_COOKIE, JSON.stringify({ state, verifier, next }), {
            ...await sessionCookieOptions(600),
            httpOnly: true
        });

        return response;

    } catch(err) {
        await logError("auth", "single sign-on could not be started", errorText(err));

        return NextResponse.redirect(await appUrl("/login?error=sso"));
    }
}
