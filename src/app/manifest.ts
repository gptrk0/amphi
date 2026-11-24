import type { MetadataRoute } from "next";

/**
 * What a phone is told when somebody adds the page to their home screen: the name under
 * the icon, the window it opens in, and the colour the splash screen flashes before the
 * first paint. Next serves it at `/manifest.webmanifest` and writes the `<link>` for it
 * into every page, which is why nothing in the layout mentions it.
 *
 * **It is a route, so the middleware has to let it through.** A manifest is fetched
 * without credentials — the cookie is not sent, deliberately, by the browser itself — and
 * a request with no session was being answered with a redirect to the login page before
 * `/manifest.webmanifest` was named in the matcher there. An install silently without an
 * icon or a name is what that looks like from the outside.
 *
 * **There is no `lang`.** Nothing here can know which of the two the reader chose: the
 * cookie that carries it is exactly what the browser leaves out of this request. The
 * name is a name in both languages and the description is English, which is the source
 * language of the dictionary anyway.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Amphi",
        short_name: "Amphi",
        description: "Browse films and series, put them on a watchlist, and let the box fetch them on its own.",

        // the discover page, which is where the sidebar's first entry points and what a
        // browser opens on: a standalone window should start where a tab would
        start_url: "/",
        scope: "/",

        display: "standalone",

        // the splash, and the bar above the window on android. The app follows the system
        // theme and a manifest may only name one colour, so it names the dark one — the
        // same `oklch(0.13 0.028 261.692)` globals.css starts from, in the hex a browser
        // can read before a stylesheet exists
        background_color: "#030712",
        theme_color: "#030712",

        // One drawing, listed twice. `maskable` is a promise that a launcher may crop the
        // icon to a circle or a squircle without cutting into it, and this one keeps
        // everything inside the middle 80% — so the same file can honestly be offered for
        // both, and `any` is still listed because a browser that ignores masking should
        // not be left without an icon at all.
        icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
    };
}
