import { NextRequest } from "next/server";

import { deleteItem, getWatchlistItem, getWatchlistItemWithMedia, stopWatching, toMediaType } from "@/lib/watchlist";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
    const { id } = await params;
    const watchlistId = Number(id);

    if (! watchlistId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    try {
        const result = await getWatchlistItemWithMedia(watchlistId);

        if (! result) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to load watchlist item!' }, { status: 500 });
    }
}

/**
 * Two different things behind one verb. Without `torrent` this only stops watching:
 * the client is untouched, and anything already downloaded stays listed under
 * Downloaded. With `torrent=1` the torrents are removed as well — `files=1` takes
 * the files with them — and the item is gone for good.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
    const { id } = await params;
    const watchlistId = Number(id);

    if (! watchlistId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    const withTorrent = req.nextUrl.searchParams.get('torrent') === "1";
    const withFiles = req.nextUrl.searchParams.get('files') === "1";

    try {
        const item = await getWatchlistItem(watchlistId);

        if (! item) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        const result = withTorrent
            ? await deleteItem(watchlistId, withFiles)
            : await stopWatching(watchlistId);

        // no title is stored, the caller renders the message from what it already knows
        return Response.json({
            success: true,
            kept: !! result,
            result: { id: item.id, tmdbId: item.tmdbId, type: toMediaType(item.type) }
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to remove from watchlist!' }, { status: 500 });
    }
}
