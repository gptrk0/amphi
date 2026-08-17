import { actorText, AuthUser } from "@/lib/auth";
import { StartedDownload } from "@/lib/grab";
import { getLibraryItem, libraryLabel } from "@/lib/library";
import { logInfo } from "@/lib/log";
import { notify, notifyUsers } from "@/lib/notify";

/**
 * Every download somebody asked for by hand, one line each. The scanner logs its own
 * grabs, and this is the other half of the answer to "where did this file come from".
 *
 * It also notifies, for the same reason: the install chat hears about everything the
 * scanner grabs, and a download somebody started themselves is the kind that most has a
 * person behind it. The title is the one a person would say — the release name is the
 * detail under it, exactly as on the scanner's own messages.
 *
 * Shared by the two ways a person can start one: the release dialog, and a release picked
 * off a manual search. It lives here rather than in either route because a download that
 * is announced on one path and silent on the other is a chat log that cannot be read.
 */
export const announceStarted = async (started: StartedDownload[], me: AuthUser | null) => {
    const who = actorText(me);

    for (const download of started) {
        await logInfo(
            "download",
            `asked for by hand: ${ download.title }`,
            `${ who }, ${ download.label }${ download.hash ? `, torrent ${ download.hash.slice(0, 8) }` : ", the client returned no hash" }`
        );

        const item = await getLibraryItem(download.libraryId);
        const label = item ? await libraryLabel(item) : download.title;

        // "asked for by Patrick" against the scanner's "for Patrick": which of the two
        // started it is the first thing anybody reading the chat wants to know
        await notify("started", label, download.title, `asked for ${ who }`);
        await notifyUsers(download.watchedBy, "started", label, download.title);
    }
};
