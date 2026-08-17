import { NextRequest } from "next/server";

import { currentUser, refuseUnlessSignedIn } from "@/lib/auth";
import { grabContext } from "@/lib/grab";
import { isIndexerConfigured } from "@/lib/indexer";
import { errorText, logDebug, logError, logWarn } from "@/lib/log";
import { isMediaType } from "@/lib/media";
import { searchReleases, SearchHint } from "@/lib/release-search";
import { loadSettings, NotConfiguredError } from "@/lib/settings";

/**
 * The manual search: words in, every release the indexers have out, each labelled with
 * what the quality profile thinks of it. Nothing is downloaded and nothing is filtered
 * away — the page decides what to show, and the search behind it is kept server side so
 * answering it with a download does not search again.
 *
 * `type` and `id` are optional and are only a fallback: the title somebody came from, used
 * for the releases whose own name TMDB cannot place. See `searchReleases`.
 */
export async function GET(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    try {
        const params = req.nextUrl.searchParams;
        const query = (params.get("q") || "").trim();
        const me = await currentUser();

        if (! query) {
            return Response.json({ success: false, message: "Type something to search for!" }, { status: 400 });
        }

        // asking before the settings are in memory would report a configured indexer as
        // missing, which is the one wrong answer here
        await loadSettings();

        // "nothing found" would be a lie when nothing was searched
        if (! isIndexerConfigured()) {
            const { message } = new NotConfiguredError("An indexer", "Indexers");

            await logWarn("download", "the manual search could not run", message);

            return Response.json({ success: false, message }, { status: 400 });
        }

        const type = params.get("type");
        const tmdbId = Number(params.get("id"));

        const hint: SearchHint | null = isMediaType(type) && tmdbId
            ? { type, tmdbId }
            : null;

        await logDebug("download", `manual search for "${ query }"`, hint ? `started from ${ hint.type } ${ hint.tmdbId }` : undefined);

        // the whole preferred list rather than the primary alone, and nothing required:
        // this page exists to show what is there, and what to make of it is the reader's
        const context = await grabContext([ me!.id ], { strict: false });
        const result = await searchReleases(query, context, hint);

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        await logError("download", "the manual search failed", errorText(err));

        return Response.json({ success: false, message: "Could not search the indexers!" }, { status: 500 });
    }
}
