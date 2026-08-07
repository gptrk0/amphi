import { NextRequest } from "next/server";

import { executeStoredPlan, getStoredPlan, toSeasonRequests } from "@/lib/download-plan";
import { executeMovieGrab, executeSeasonGrab, planMovieGrab, planSeasonGrab, StartedDownload } from "@/lib/grab";
import { MissingSeason } from "@/types/download";

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
    try {
        const body = await req.json();

        const planId = typeof body?.planId === "string" ? body.planId : null;

        if (planId) {
            const plan = getStoredPlan(planId);

            if (! plan) {
                // searching again is the only honest answer, and it is the client
                // that knows what was asked for
                return Response.json({ success: false, expired: true, message: "The search results expired, please try again." }, { status: 410 });
            }

            const started = await executeStoredPlan(plan, toPicks(body?.picks));

            return Response.json({
                success: true,
                started,
                message: started.length > 0
                    ? `Started ${ started.length } download${ started.length > 1 ? "s" : "" }.`
                    : "Could not start the download."
            });
        }

        const type = body?.type;
        const id = Number(body?.id);
        const seasons = toSeasonRequests(body?.seasons);

        if (! id || (type !== "movie" && type !== "tv")) {
            return Response.json({ success: false, message: "Invalid type or id!" }, { status: 400 });
        }

        if (type === "movie") {
            const plan = await planMovieGrab(id);

            if (! plan) {
                return Response.json({ success: false, message: "Media not found on tmdb!" }, { status: 404 });
            }

            if (! plan.release) {
                return Response.json({
                    success: true,
                    started: [],
                    missingMovie: true,
                    message: `Not available on your indexers yet (${ plan.resultCount } results were filtered out).`
                });
            }

            const started = await executeMovieGrab(id, plan.release);

            return Response.json({
                success: true,
                started: started ? [ started ] : [],
                missingMovie: false,
                message: started ? `Downloading ${ started.title }` : "Could not start the download."
            });
        }

        if (seasons.length === 0) {
            return Response.json({ success: false, message: "Pick at least one season!" }, { status: 400 });
        }

        const started: StartedDownload[] = [];
        const missing: MissingSeason[] = [];

        for (const { seasonNumber, episodeNumbers } of seasons) {
            const wanted = episodeNumbers.length > 0 ? episodeNumbers : undefined;
            const plan = await planSeasonGrab(id, seasonNumber, { episodeNumbers: wanted });

            if (! plan) {
                continue;
            }

            if (plan.pack || plan.episodes.some(episode => episode.release)) {
                started.push(...await executeSeasonGrab(id, plan, { episodeNumbers: wanted }));
            }

            // only report what was actually asked for as missing
            const gaps = wanted ? plan.missing.filter(v => wanted.includes(v)) : plan.missing;

            if (gaps.length > 0) {
                missing.push({ seasonNumber, episodeNumbers: gaps });
            }
        }

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

        return Response.json({ success: false, message: "Failed to start the download!" }, { status: 500 });
    }
}
