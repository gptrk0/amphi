import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/cookies";

/**
 * The front door, and only the front door. Middleware runs on the edge runtime, where
 * there is no database and no node crypto — so all this can tell is whether the
 * browser is carrying a session cookie at all, not whether it is a good one.
 *
 * That is deliberate and it is enough, because **it is not the security boundary**.
 * Every route handler asks `refuseUnlessSignedIn` or `refuseUnlessAdmin` for itself,
 * against the actual table. What happens here is the other thing: sending somebody
 * who is not signed in to the login page instead of to an empty screen that quietly
 * failed to load, and answering an api call with a 401 instead of a redirect no
 * fetch() knows what to do with.
 */

// the login page needs the state endpoint before anybody is signed in, and the single
// sign-on legs are by definition reached without a session
const PUBLIC = [ "/login", "/setup", "/api/auth" ];

export function middleware(req: NextRequest) {
    const path = req.nextUrl.pathname;

    if (PUBLIC.some(prefix => path === prefix || path.startsWith(`${ prefix }/`))) {
        return NextResponse.next();
    }

    if (req.cookies.get(SESSION_COOKIE)) {
        return NextResponse.next();
    }

    if (path.startsWith("/api/")) {
        return NextResponse.json({ success: false, message: "Sign in first." }, { status: 401 });
    }

    const url = new URL("/login", req.url);

    // back to where they were going, once they are through
    url.searchParams.set("next", `${ path }${ req.nextUrl.search }`);

    return NextResponse.redirect(url);
}

export const config = {
    matcher: [
        // everything except next's own assets and the files in public/
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
    ]
};
