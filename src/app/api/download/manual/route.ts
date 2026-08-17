import { NextRequest } from "next/server";

import { announceStarted } from "@/lib/announce";
import { currentUser, refuseUnlessSignedIn } from "@/lib/auth";
import { errorText, logError, logInfo, logWarn } from "@/lib/log";
import { getStoredSearch, grabFromSearch } from "@/lib/release-search";
import { isIndexerConfigured } from "@/lib/indexer";
import { isClientConfigured } from "@/lib/torrent";
import { loadSettings, NotConfiguredError } from "@/lib/settings";

/**
 * Asked before anything is promised. A download needs both an indexer to find a release
 * and a client to hand it to, and saying which one is missing is the difference between
 * a setup step and a bug.
 */
const missingService = async () => {
    await loadSettings();

    if (! isIndexerConfigured()) {
        return new NotConfiguredError("An indexer", "Indexers").message;
    }

    if (! isClientConfigured()) {
        return new NotConfiguredError("The torrent client", "Torrent client").message;
    }

    return null;
};

/**
 * One release off a manual search, started. `searchId` is the search it came from and
 * `guid` is the row — the download link stayed on the server, so this is the whole of
 * what the browser can ask for.
 *
 * The quality profile is not consulted: the row said why it would have been refused, and
 * pressing the button on it is the answer to that.
 */
export async function POST(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    try {
        const body = await req.json();

        // a manual download is on nobody's watchlist, so this is the only record of
        // whose it is — both for the log and for the notification when it lands
        const me = await currentUser();

        const notConfigured = await missingService();

        if (notConfigured) {
            await logWarn("download", "a manual download was asked for and refused", notConfigured);

            return Response.json({ success: false, message: notConfigured }, { status: 400 });
        }

        const searchId = typeof body?.searchId === "string" ? body.searchId : "";
        const guid = typeof body?.guid === "string" ? body.guid : "";

        if (! searchId || ! guid) {
            return Response.json({ success: false, message: "Invalid search or release!" }, { status: 400 });
        }

        const search = getStoredSearch(searchId);

        if (! search) {
            // searching again is the only honest answer, and it is the page that knows
            // what was asked for
            return Response.json({ success: false, expired: true, message: "This search expired, please search again." }, { status: 410 });
        }

        const result = await grabFromSearch(search, guid, me!.id);

        if (! result) {
            return Response.json({ success: false, expired: true, message: "That release is not in this search any more." }, { status: 410 });
        }

        // the row says so and offers no button, so this is the guard rather than the
        // message anybody should be reading
        if (! result.hit.match) {
            return Response.json({
                success: false,
                message: "There is no telling which title this release is of, so there is nowhere to file it. Open the title's own page and download it from there."
            }, { status: 400 });
        }

        const started = result.started;

        // which title this was filed under, said before anything else about it: the
        // attribution is a guess read out of the release name, and it is the one thing
        // about this path that can be wrong in a way nothing later would show
        if (started) {
            await logInfo(
                "download",
                `manual pick: ${ started.title }`,
                `filed under ${ result.hit.match.name } (${ result.hit.match.type } ${ result.hit.match.tmdbId })`
                    + `${ result.hit.episodes.length > 0 ? `, ${ result.hit.episodes.length } episodes` : "" }`
                    + `${ result.hit.match.held ? " — already in the library in this edition" : "" }`
            );
        }

        await announceStarted(started ? [ started ] : [], me);

        if (! started) {
            await logWarn(
                "download",
                `${ result.hit.release.title } could not be started`,
                "the torrent client did not take it, so nothing was kept"
            );

            return Response.json({
                success: true,
                started: [],
                message: "The torrent client did not take that release."
            });
        }

        return Response.json({
            success: true,
            started: [ started ],
            message: `Downloading ${ started.title }`
        });

    } catch(err) {
        console.error(err);

        if (err instanceof NotConfiguredError) {
            await logWarn("download", "a manual download was asked for and refused", err.message);

            return Response.json({ success: false, message: err.message }, { status: 400 });
        }

        await logError("download", "starting a manual download failed", errorText(err));

        return Response.json({ success: false, message: "Failed to start the download!" }, { status: 500 });
    }
}
