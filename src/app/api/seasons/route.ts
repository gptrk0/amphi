import { NextRequest } from "next/server";

import { refuseUnlessSignedIn } from "@/lib/auth";
import { getTvSeasons } from "@/lib/media";
import { toSeasonInfo } from "@/types/media";

/**
 * A show's seasons and episodes, for a picker that is not on the details page.
 *
 * The details page never needed this — it is server rendered and reads the same cache
 * directly. But the download dialog can be opened from a poster or a row, and until now
 * there was no way for the browser to learn what episodes a show even has: pressing
 * Download there sent no selection and the api refused it. Same TMDB cache behind it, so
 * this costs a request and not a lookup.
 */
export async function GET(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const tmdbId = Number(req.nextUrl.searchParams.get("id"));

    if (! tmdbId) {
        return Response.json({ success: false, message: "Invalid id!" }, { status: 400 });
    }

    try {
        return Response.json({ success: true, result: toSeasonInfo(await getTvSeasons(tmdbId)) });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Failed to load the seasons!" }, { status: 500 });
    }
}
