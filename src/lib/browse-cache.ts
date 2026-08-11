/**
 * What a listing was showing, remembered for as long as the tab is open.
 *
 * Every browse page here fetches on mount, which is why stepping back into one used to
 * cost a second of skeletons and lose the position on the page (and, on an infinitely
 * scrolled grid, the four pages that had been loaded into it). None of that is a server
 * problem — the answers are already cached behind the api — it is that the client threw
 * the result away the moment the component unmounted.
 *
 * So the components hand their state here on the way out and read it back on the way in.
 * Deliberately in memory and deliberately not `sessionStorage`: this is the same tab and
 * the same navigation session, a reload is supposed to be a fresh look, and a poster list
 * is far too big to be worth serialising.
 *
 * **The language is part of the key**, at every call site. A listing is TMDB titles and
 * plot summaries, which come back in the reader's own language, so the same rows in two
 * languages are two different listings — and remembering them separately is also what makes
 * switching back and forth instant instead of a fetch each way.
 *
 * **Freshness is the caller's decision, not this module's.** A discover row shows what it
 * had and refetches quietly behind it (so nothing is stale for longer than a moment, and
 * the page keeps its height while that happens); a paged grid keeps what it had, because
 * refetching page one would drop pages two to four. Neither wants a TTL: a listing kept
 * open for an hour is a listing nobody is looking at.
 */

// enough for every discover view, a handful of genres and the recent searches. The cap is
// a leak guard, not a policy — a session that browses past it is dropping its oldest entry,
// which is the one furthest back in the history anyway
const LIMIT = 40;

const store = new Map<string, unknown>();

export const cached = <T>(key: string): T | undefined => store.get(key) as T | undefined;

export const remember = <T>(key: string, value: T) => {
    // re-inserted so the oldest key is genuinely the least recently written
    store.delete(key);
    store.set(key, value);

    if (store.size > LIMIT) {
        store.delete(store.keys().next().value!);
    }
};
