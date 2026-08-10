import { NextRequest, NextResponse } from "next/server";

import { createSession, sameToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { errorText, logError, logInfo, logWarn } from "@/lib/log";
import { appUrl, finishLogin, OidcSignInError, STATE_COOKIE, userForProfile } from "@/lib/oidc";
import { loadSettings } from "@/lib/settings";

/**
 * The way back. Whatever happens the browser ends up on a page rather than on a JSON
 * error — this address is reached by a redirect from another site, and a stack trace
 * in the window is not an answer to "I clicked sign in".
 *
 * Built from the public address and not from `req.url`: a proxy that does not forward
 * the host leaves the container's own socket in the request, and this used to land
 * people on `0.0.0.0:3000` after signing in successfully.
 */
const back = async (message: string) => {
    const url = new URL(await appUrl("/login"));

    url.searchParams.set("message", message);

    const response = NextResponse.redirect(url);

    response.cookies.delete(STATE_COOKIE);

    return response;
};

// only inside this app: an open redirect is the classic way a login page becomes
// somebody else's phishing page
const safeNext = (value: unknown) => {
    return typeof value === "string" && value.startsWith("/") && ! value.startsWith("//") ? value : "/";
};

export async function GET(req: NextRequest) {
    try {
        await loadSettings();

        const params = req.nextUrl.searchParams;
        const error = params.get("error");

        if (error) {
            await logWarn("auth", "the provider refused a sign-in", params.get("error_description") || error);

            return await back(params.get("error_description") || "The provider refused the sign-in.");
        }

        const code = params.get("code");
        const state = params.get("state");
        const stored = req.cookies.get(STATE_COOKIE)?.value;

        if (! code || ! state || ! stored) {
            return await back("That sign-in attempt has expired — try again.");
        }

        const saved = JSON.parse(stored) as { state?: string, verifier?: string, next?: string };

        // the whole of the CSRF protection: the code is only accepted with the state
        // this server generated for this browser
        if (! saved.state || ! saved.verifier || ! sameToken(saved.state, state)) {
            await logWarn("auth", "a single sign-on callback arrived with the wrong state", "it was refused");

            return await back("That sign-in attempt could not be verified — try again.");
        }

        const profile = await finishLogin(code, saved.verifier);
        const user = await userForProfile(profile);

        const { token, maxAge } = await createSession(user.id);

        const response = NextResponse.redirect(await appUrl(safeNext(saved.next)));

        response.cookies.set(SESSION_COOKIE, token, await sessionCookieOptions(maxAge));
        response.cookies.delete(STATE_COOKIE);

        await logInfo("auth", `${ user.email } signed in`, `through the provider as ${ profile.subject }`);

        return response;

    } catch(err) {
        if (err instanceof OidcSignInError) {
            await logWarn("auth", "a single sign-on was refused", err.message);

            return await back(err.message);
        }

        await logError("auth", "a single sign-on failed", errorText(err));

        return await back("Single sign-on failed. The log has the details.");
    }
}
