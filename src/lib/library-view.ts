import { Translate } from "@/i18n";
import { LibraryItem } from "@/types/library";

/**
 * How the library page turns downloads into what a person sees. It is here rather than
 * inside the table because none of it draws anything: it groups, adds up and words the
 * rows, and that is the part worth being able to run on its own.
 *
 * **Why the api sends keys and this says them.** A download carries a set of
 * `season:episode` keys. The sentence about them — "S01 — 10 episodes" — depends on two
 * things the server does not know: who is reading, and whether the question is about one
 * torrent or about every torrent of one title. `coverText` in [library.ts](src/lib/library.ts)
 * is the other half of this and stays where it is: the log and the notifications are
 * written once, in the record language, and are not re-worded per reader.
 */

/** One title and every download of it. The unit the table lists. */
export type Group = {
    key: string;
    items: LibraryItem[];
};

export const toEpisode = (key: string) => {
    const [ seasonNumber, episodeNumber ] = key.split(":");

    return { seasonNumber: Number(seasonNumber), episodeNumber: Number(episodeNumber) };
};

const code = (value: number) => String(value).padStart(2, "0");

export const byEpisode = (a: string, b: string) => {
    const left = toEpisode(a);
    const right = toEpisode(b);

    return left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber;
};

export const episodeName = (key: string) => {
    const { seasonNumber, episodeNumber } = toEpisode(key);

    return `S${ code(seasonNumber) }E${ code(episodeNumber) }`;
};

/**
 * What a row covers, as a person would say it. The same function answers for one download
 * and for a whole title, because the question is the same one asked of a bigger set.
 */
export const coversText = (keys: string[], t: Translate) => {
    if (keys.length === 0) {
        return "";
    }

    if (keys.length === 1) {
        return episodeName(keys[0]);
    }

    const seasons = [ ...new Set(keys.map(key => toEpisode(key).seasonNumber)) ].sort((a, b) => a - b);

    const where = seasons.length === 1
        ? `S${ code(seasons[0]) }`
        : `S${ code(seasons[0]) }–S${ code(seasons[seasons.length - 1]) }`;

    return `${ where } — ${ t("libraryPage.episodesCovered", { n: keys.length }) }`;
};

/** Which ones exactly, for the summary line that only had room to count them. */
export const episodeListText = (keys: string[]) => [ ...keys ].sort(byEpisode).map(episodeName).join(", ");

export const groupKey = (item: LibraryItem) => `${ item.type }:${ item.tmdbId }`;

/**
 * Every episode of a title that is on disk, counted once. A season pack and a single
 * episode can overlap — the same episode fetched twice is one episode here, and two
 * torrents everywhere else.
 */
export const groupEpisodes = (group: Group) => [ ...new Set(group.items.flatMap(item => item.episodeKeys)) ];

export const groupSize = (group: Group) => group.items.reduce((total, item) => total + (item.sizeBytes || 0), 0);

/** The distinct ones, in the order they turned up, with the empties dropped. */
export const unique = (values: string[]) => [ ...new Set(values.filter(Boolean)) ];

/**
 * The downloads, grouped by what they are downloads *of*. A series fetched episode by
 * episode is thirty torrents and thirty things to delete, but it is one thing to look
 * for; the same film in two languages is two rows that only the language column tells
 * apart.
 *
 * The groups come out in the order the list arrived in — the table sorts them itself.
 * Inside a group the order is what each download covers rather than when it was fetched:
 * an episode grabbed a week late is still episode four. A film has nothing to order by
 * and falls through to the date.
 */
export const toGroups = (items: LibraryItem[]): Group[] => {
    const groups: Group[] = [];
    const byTitle = new Map<string, Group>();

    for (const item of items) {
        const key = groupKey(item);
        const group = byTitle.get(key);

        if (group) {
            group.items.push(item);

        } else {
            const created = { key, items: [ item ] };

            byTitle.set(key, created);
            groups.push(created);
        }
    }

    for (const group of groups) {
        group.items.sort((a, b) => {
            const left = [ ...a.episodeKeys ].sort(byEpisode)[0];
            const right = [ ...b.episodeKeys ].sort(byEpisode)[0];

            return (left && right ? byEpisode(left, right) : 0) || a.startedAt.localeCompare(b.startedAt);
        });
    }

    return groups;
};
