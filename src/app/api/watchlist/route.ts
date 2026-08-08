import { NextRequest } from "next/server";

import { logInfo } from "@/lib/log";
import { syncDownloadsOnce } from "@/lib/scheduler";
import { listManagedTorrents } from "@/lib/torrent";
import { addToWatchlist, getWatchlistSlim, getWatchlistWithMedia, setMonitored, toContentType } from "@/lib/watchlist";

/** A title the log can be read by, since no name is stored anywhere. */
const label = (name: string | null | undefined, tmdbId: number) => name || `TMDB #${ tmdbId }`;

export async function GET(req: NextRequest) {
    const slim = req.nextUrl.searchParams.get('slim');
    // only the table asks for this, it costs a qBittorrent call
    const live = req.nextUrl.searchParams.get('live') === "1";

    try {
        const torrents = live ? await listManagedTorrents() : null;

        // the same list the rows are drawn from also finishes them: whoever is
        // watching the table sees a download flip to done in seconds instead of
        // waiting for the next scheduled round
        if (torrents) {
            await syncDownloadsOnce(torrents);
        }

        const result = slim ? await getWatchlistSlim() : await getWatchlistWithMedia(torrents);

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to load watchlist!' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const tmdbId = Number(body?.tmdbId);
        const type = toContentType(body?.type);

        // when given, only these seasons are monitored
        const seasons = Array.isArray(body?.seasons) ? body.seasons.map(Number).filter(Boolean) : undefined;

        if (! tmdbId || ! type) {
            return Response.json({ success: false, message: 'Invalid tmdbId or type!' }, { status: 400 });
        }

        const result = await addToWatchlist(tmdbId, type, seasons);

        if (! result) {
            return Response.json({ success: false, message: 'Media not found on tmdb!' }, { status: 404 });
        }

        await logInfo(
            "watchlist",
            `added: ${ label(result.media?.name, tmdbId) }`,
            seasons ? `watching season${ seasons.length === 1 ? "" : "s" } ${ seasons.join(", ") || "none yet" }` : "watching everything"
        );

        return Response.json({
            success: true,
            message: `${ result.media?.name || "Media" } added to your watchlist!`,
            result
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to add to watchlist!' }, { status: 500 });
    }
}

/**
 * Turns a season or single episodes on and off. Works by tmdbId rather than by row
 * id, because ticking the first episode of a show that is not on the watchlist yet
 * has to create the row — and unticking the last one deletes it again, in which case
 * `result` comes back null.
 */
export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();

        const tmdbId = Number(body?.tmdbId);
        const type = toContentType(body?.type);
        const monitored = body?.monitored;

        const seasonNumber = body?.seasonNumber === undefined ? undefined : Number(body.seasonNumber);
        const episodeNumbers = Array.isArray(body?.episodes) ? body.episodes.map(Number) : undefined;

        if (! tmdbId || ! type || typeof monitored !== "boolean") {
            return Response.json({ success: false, message: 'Invalid tmdbId, type or monitored flag!' }, { status: 400 });
        }

        if (seasonNumber !== undefined && Number.isNaN(seasonNumber)) {
            return Response.json({ success: false, message: 'Invalid season number!' }, { status: 400 });
        }

        if (episodeNumbers?.some(Number.isNaN)) {
            return Response.json({ success: false, message: 'Invalid episode number!' }, { status: 400 });
        }

        const result = await setMonitored(tmdbId, type, monitored, { seasonNumber, episodeNumbers });

        const what = [
            seasonNumber === undefined ? "every season" : `S${ String(seasonNumber).padStart(2, "0") }`,
            episodeNumbers ? `E${ episodeNumbers.join(",E") }` : ""
        ].filter(Boolean).join("");

        await logInfo(
            "watchlist",
            `${ monitored ? "watching" : "no longer watching" } ${ what }: ${ label(result?.media?.name, tmdbId) }`,
            result ? undefined : "nothing is left to watch on it, so it came off the watchlist"
        );

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to update the watchlist!' }, { status: 500 });
    }
}
