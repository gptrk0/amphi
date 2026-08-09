import { languageProfileOf, primaryLanguage } from "@/lib/language";

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
 * - the same edition, whoever fetched it;
 * - a download taken **for** them, which is how a language accepted by hand at the
 *   dialog stops being asked about;
 * - anything from before editions existed, because unknown belongs to everybody and
 *   an upgrade must not fetch the whole library a second time.
 */
export type LibraryAudience = { language: string, userIds: number[] };

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
            { language: audience.language },
            { language: "" },
            ...(audience.userIds.length > 0 ? [ { watchedBy: { hasSome: audience.userIds } } ] : [])
        ]
    };
};

export const audienceForUser = async (userId: number): Promise<LibraryAudience> => {
    const profile = await languageProfileOf(userId);

    return { language: primaryLanguage(profile), userIds: [ userId ] };
};
