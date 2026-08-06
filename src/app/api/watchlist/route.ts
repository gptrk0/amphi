import { NextRequest } from "next/server";

import { addToWatchlist, getWatchlistSlim, getWatchlistWithMedia, toContentType } from "@/lib/watchlist";

export async function GET(req: NextRequest) {
    const slim = req.nextUrl.searchParams.get('slim');

    try {
        let result = slim ? await getWatchlistSlim() : await getWatchlistWithMedia();

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to load watchlist!' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        let body = await req.json();

        let tmdbId = Number(body?.tmdbId);
        let type = toContentType(body?.type);

        // when given, only these seasons are monitored
        let seasons = Array.isArray(body?.seasons) ? body.seasons.map(Number).filter(Boolean) : undefined;

        if (! tmdbId || ! type) {
            return Response.json({ success: false, message: 'Invalid tmdbId or type!' }, { status: 400 });
        }

        let result = await addToWatchlist(tmdbId, type, seasons);

        if (! result) {
            return Response.json({ success: false, message: 'Media not found on tmdb!' }, { status: 404 });
        }

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
