import { getWatchlistItem, getWatchlistItemWithMedia, removeFromWatchlist, toMediaType } from "@/lib/watchlist";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
    let { id } = await params;
    let watchlistId = Number(id);

    if (! watchlistId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    try {
        let result = await getWatchlistItemWithMedia(watchlistId);

        if (! result) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to load watchlist item!' }, { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: Params) {
    let { id } = await params;
    let watchlistId = Number(id);

    if (! watchlistId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    try {
        let item = await getWatchlistItem(watchlistId);

        if (! item) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        await removeFromWatchlist(watchlistId);

        // no title is stored, the caller renders the message from what it already knows
        return Response.json({
            success: true,
            result: { id: item.id, tmdbId: item.tmdbId, type: toMediaType(item.type) }
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to remove from watchlist!' }, { status: 500 });
    }
}
