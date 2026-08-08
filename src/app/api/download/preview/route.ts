import { NextRequest } from "next/server";

import { buildPreview, toSeasonRequests } from "@/lib/download-plan";
import { isIndexerConfigured } from "@/lib/indexer";
import { loadSettings, NotConfiguredError } from "@/lib/settings";

/**
 * Searches without grabbing anything: the answer is what the download dialog puts
 * on screen. The plan behind it is kept server side, and `planId` is how the
 * chosen releases find their way back to it.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const type = body?.type;
        const id = Number(body?.id);
        const seasons = toSeasonRequests(body?.seasons);

        if (! id || (type !== "movie" && type !== "tv")) {
            return Response.json({ success: false, message: "Invalid type or id!" }, { status: 400 });
        }

        if (type === "tv" && seasons.length === 0) {
            return Response.json({ success: false, message: "Pick at least one episode!" }, { status: 400 });
        }

        // asking before the settings are in memory would report a configured indexer as
        // missing, which is the one wrong answer here
        await loadSettings();

        // "no releases found" would be a lie when nothing was searched
        if (! isIndexerConfigured()) {
            return Response.json({
                success: false,
                message: new NotConfiguredError("An indexer", "Indexers").message
            }, { status: 400 });
        }

        const preview = await buildPreview(type, id, seasons);

        if (! preview) {
            return Response.json({ success: false, message: "Media not found on tmdb!" }, { status: 404 });
        }

        return Response.json({ success: true, result: preview });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not search the indexers!" }, { status: 500 });
    }
}
