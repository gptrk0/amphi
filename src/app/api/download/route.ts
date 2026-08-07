import { NextRequest } from "next/server";

import { executeMovieGrab, executeSeasonGrab, planMovieGrab, planSeasonGrab, StartedDownload } from "@/lib/grab";

export type MissingSeason = {
    seasonNumber: number;
    episodeNumbers: number[];
};

type SeasonRequest = {
    seasonNumber: number;
    episodeNumbers: number[];
};

/**
 * `seasons` is either a list of season numbers (the whole season) or a list of
 * `{ seasonNumber, episodeNumbers }` — an empty episode list also means the whole
 * season.
 */
const toSeasonRequests = (value: unknown): SeasonRequest[] => {
    if (! Array.isArray(value)) {
        return [];
    }

    return value
        .map(entry => {
            const seasonNumber = Number(typeof entry === "object" && entry !== null ? (entry as any).seasonNumber : entry);
            const episodes = typeof entry === "object" && entry !== null ? (entry as any).episodeNumbers : null;

            return {
                seasonNumber,
                episodeNumbers: Array.isArray(episodes) ? episodes.map(Number).filter((v: number) => ! Number.isNaN(v)) : []
            };
        })
        .filter(entry => ! Number.isNaN(entry.seasonNumber));
};

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

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
