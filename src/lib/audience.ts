import { languageProfileOf, searchLanguages } from "@/lib/language";

/**
 * Who a download is an answer for.
 *
 * The library is shared and it always will be — one disk, one household. What is not
 * shared is what counts as *having* something: a film fetched in English answers the
 * people who wanted it in English, and to somebody waiting for the Hungarian release
 * it is a different film that happens to have the same name.
 *
 * So every question of the form "do we already have this" is asked on behalf of
 * somebody, and this is that somebody. Three things count as theirs:
 *
 * - the same edition, whoever fetched it — or any edition the asker accepts, when their
 *   account says every language on its list will do;
 * - a download taken **for** them, which is how a language accepted by hand at the
 *   dialog stops being asked about;
 * - anything from before editions existed, because unknown belongs to everybody and
 *   an upgrade must not fetch the whole library a second time.
 */
export type LibraryAudience = { languages: string[], userIds: number[] };

/**
 * `null` asks about the shelf itself rather than one person's half of it — what the
 * library page lists, where every download is somebody's and all of them are shown.
 */
export const libraryFilter = (audience: LibraryAudience | null) => {
    if (! audience) {
        return { removedAt: null };
    }

    return {
        removedAt: null,
        OR: [
            // more than one when the account accepts every language on its list: then a
            // copy in any of them is an answer, and asking about the primary alone would
            // send the scanner after a file it already has
            { language: { in: audience.languages } },
            { language: "" },
            ...(audience.userIds.length > 0 ? [ { watchedBy: { hasSome: audience.userIds } } ] : [])
        ]
    };
};

/**
 * `requested` is the language a single watchlist row asked for, when there is a row in
 * hand: the same person can be waiting for one title in Hungarian and another in
 * English, so "do we have this" has no answer per person, only per row.
 */
export const audienceForUser = async (userId: number, requested?: string | null): Promise<LibraryAudience> => {
    const profile = await languageProfileOf(userId);

    return { languages: searchLanguages(profile, requested), userIds: [ userId ] };
};
