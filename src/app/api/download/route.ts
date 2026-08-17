import { NextRequest } from "next/server";

import { announceStarted } from "@/lib/announce";
import { currentUser, refuseUnlessSignedIn } from "@/lib/auth";
import { executeStoredPlan, getStoredPlan, toSeasonRequests } from "@/lib/download-plan";
import { executeMovieGrab, executeSeasonGrab, grabContext, planMovieGrab, planSeasonGrab, StartedDownload } from "@/lib/grab";
import { isIndexerConfigured } from "@/lib/indexer";
import { errorText, logError, logInfo, logWarn } from "@/lib/log";
import { isClientConfigured } from "@/lib/torrent";
import { loadSettings, NotConfiguredError } from "@/lib/settings";
import { MissingSeason } from "@/types/download";

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

const toPicks = (value: unknown): Record<string, string> => {
    if (typeof value !== "object" || value === null) {
        return {};
    }

    const picks: Record<string, string> = {};

    for (const [ key, guid ] of Object.entries(value as Record<string, unknown>)) {
        if (typeof guid === "string") {
            picks[key] = guid;
        }
    }

    return picks;
};

/**
 * With a `planId` the releases the user picked in the dialog are grabbed. Without
 * one the quality profile decides on its own, the same way the scanner does.
 */
export async function POST(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    try {
        const body = await req.json();

        // an instant download never touches a watchlist, so this is the only record
        // of whose it is — both for the log and for the notification when it lands
        const me = await currentUser();

        const notConfigured = await missingService();

        if (notConfigured) {
            await logWarn("download", "a download was asked for and refused", notConfigured);

            return Response.json({ success: false, message: notConfigured }, { status: 400 });
        }

        const planId = typeof body?.planId === "string" ? body.planId : null;

        if (planId) {
            const plan = getStoredPlan(planId);

            if (! plan) {
                // searching again is the only honest answer, and it is the client
                // that knows what was asked for
                return Response.json({ success: false, expired: true, message: "The search results expired, please try again." }, { status: 410 });
            }

            const started = await executeStoredPlan(plan, toPicks(body?.picks), me?.id ?? null);

            await announceStarted(started, me);

            // silence here was how a download could look like a watchlisting: the
            // grab puts what it cannot start back on the watchlist, and nothing said so
            if (started.length === 0) {
                await logWarn(
                    "download",
                    `the chosen release could not be started for tmdb ${ plan.tmdbId }`,
                    "the torrent client did not take it, so it went back on the watchlist"
                );
            }

            return Response.json({
                success: true,
                started,
                message: started.length > 0
                    ? `Started ${ started.length } download${ started.length > 1 ? "s" : "" }.`
                    : "The torrent client did not take that release — it is on your watchlist instead."
            });
        }

        const type = body?.type;
        const id = Number(body?.id);
        const seasons = toSeasonRequests(body?.seasons);

        if (! id || (type !== "movie" && type !== "tv")) {
            return Response.json({ success: false, message: "Invalid type or id!" }, { status: 400 });
        }

        // by hand, so the whole list is on offer rather than the primary language
        // alone — but it is still this person's list, and what comes of it is theirs
        const context = await grabContext([ me!.id ], { strict: false });

        if (type === "movie") {
            const plan = await planMovieGrab(id, context);

            if (! plan) {
                return Response.json({ success: false, message: "Media not found on tmdb!" }, { status: 404 });
            }

            if (! plan.release) {
                await logInfo("download", `nothing usable for movie ${ id }`, `${ plan.resultCount } results came back and every one was filtered out`);

                return Response.json({
                    success: true,
                    started: [],
                    missingMovie: true,
                    message: `Not available on your indexers yet (${ plan.resultCount } results were filtered out).`
                });
            }

            const started = await executeMovieGrab(id, plan.release, context, me!.id);

            await announceStarted(started ? [ started ] : [], me);

            if (! started) {
                await logWarn(
                    "download",
                    `${ plan.release.title } could not be started`,
                    "the torrent client did not take it, so it went back on the watchlist"
                );
            }

            return Response.json({
                success: true,
                started: started ? [ started ] : [],
                missingMovie: false,
                message: started
                    ? `Downloading ${ started.title }`
                    : "The torrent client did not take that release — it is on your watchlist instead."
            });
        }

        if (seasons.length === 0) {
            return Response.json({ success: false, message: "Pick at least one season!" }, { status: 400 });
        }

        const started: StartedDownload[] = [];
        const missing: MissingSeason[] = [];

        for (const { seasonNumber, episodeNumbers } of seasons) {
            const wanted = episodeNumbers.length > 0 ? episodeNumbers : undefined;
            const plan = await planSeasonGrab(id, seasonNumber, context, { episodeNumbers: wanted });

            if (! plan) {
                continue;
            }

            if (plan.pack || plan.episodes.some(episode => episode.release)) {
                started.push(...await executeSeasonGrab(id, plan, context, { episodeNumbers: wanted, requestedBy: me!.id }));
            }

            // only report what was actually asked for as missing
            const gaps = wanted ? plan.missing.filter(v => wanted.includes(v)) : plan.missing;

            if (gaps.length > 0) {
                missing.push({ seasonNumber, episodeNumbers: gaps });
            }
        }

        await announceStarted(started, me);

        return Response.json({
            success: true,
            started,
            missing,
            message: started.length > 0
                ? `Started ${ started.length } download${ started.length > 1 ? "s" : "" }.`
                : "Nothing is available for download yet."
        });

    } catch(err) {
        console.error(err);

        // a setting that was cleared between the check above and the grab, or a path that
        // does not check: still the user's answer, not a server error
        if (err instanceof NotConfiguredError) {
            await logWarn("download", "a download was asked for and refused", err.message);

            return Response.json({ success: false, message: err.message }, { status: 400 });
        }

        await logError("download", "starting a download failed", errorText(err));

        return Response.json({ success: false, message: "Failed to start the download!" }, { status: 500 });
    }
}
