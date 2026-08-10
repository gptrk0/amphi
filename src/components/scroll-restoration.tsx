'use client';

import { useEffect } from "react";

/**
 * Stepping back lands where you were, not at the top.
 *
 * **Why the browser cannot do this on its own here.** Scroll restoration needs the page to
 * be as tall as it was, and every listing in this app is drawn from a fetch that starts
 * *after* the component mounts. At the moment the browser (and Next's own restoration)
 * tries to put the scroll back, the page is a header and three skeletons — a few hundred
 * pixels — so the position is clamped to the top and then the real content arrives under
 * it. Scrolling to the tenth row of a discover page, opening something, and coming back to
 * the first row is the whole of the complaint.
 *
 * **So it waits.** The position is kept per URL while the tab lives, and a back or forward
 * step starts a loop that puts it back as soon as the document is tall enough to hold it,
 * giving up after three seconds. It is a loop rather than a lock, and any wheel, touch or
 * key aborts it: a page that is still growing must never drag somebody back to where they
 * used to be while they are reading.
 *
 * The other half of this lives in the listings themselves — [browse-cache.ts](src/lib/browse-cache.ts),
 * which lets a page come back with the rows it already had instead of fetching them again.
 * That is what usually makes the wait a single frame.
 *
 * Nothing is written to `sessionStorage` and nothing is read from history state: a reload
 * is the browser's own business, and this stays out of the way of Next's history entries.
 */

const positions = new Map<string, number>();

// the query string is part of it: /search?q=a and /search?q=b are two different lists
const here = () => `${ window.location.pathname }${ window.location.search }`;

const GIVE_UP_MS = 3000;

export function ScrollRestoration() {
    useEffect(() => {
        const save = () => {
            positions.set(here(), window.scrollY);
        };

        // the running attempt, so a second back step cancels the first one's loop
        let stop = () => {};

        const restore = () => {
            stop();

            const target = positions.get(here());

            if (! target) {
                return;
            }

            let frame = 0;
            const deadline = Date.now() + GIVE_UP_MS;
            const abort = () => stop();

            stop = () => {
                cancelAnimationFrame(frame);
                window.removeEventListener("wheel", abort);
                window.removeEventListener("touchstart", abort);
                window.removeEventListener("keydown", abort);
                stop = () => {};
            };

            const tick = () => {
                // only once the page can actually hold that position — before then the
                // browser would clamp it and the attempt would be spent
                if (document.documentElement.scrollHeight - window.innerHeight >= target) {
                    window.scrollTo(0, target);
                    stop();

                    return;
                }

                if (Date.now() > deadline) {
                    stop();

                    return;
                }

                frame = requestAnimationFrame(tick);
            };

            window.addEventListener("wheel", abort, { passive: true });
            window.addEventListener("touchstart", abort, { passive: true });
            window.addEventListener("keydown", abort);

            frame = requestAnimationFrame(tick);
        };

        // popstate is exactly the question being answered — it fires after the location
        // has changed, so `here()` is already the page being returned to. A forward
        // navigation has no entry under its URL yet and correctly starts at the top
        window.addEventListener("popstate", restore);
        window.addEventListener("scroll", save, { passive: true });

        return () => {
            stop();
            window.removeEventListener("popstate", restore);
            window.removeEventListener("scroll", save);
        };
    }, []);

    return null;
}
