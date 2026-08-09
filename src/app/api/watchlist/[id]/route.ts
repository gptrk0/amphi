import { currentUser, refuseUnlessSignedIn, withActor } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import { getWatchlistItem, stopWatching, toMediaType } from "@/lib/watchlist";

type Params = { params: Promise<{ id: string }> };

/**
 * Stop watching, which is all a watchlist row can be asked to do now: it holds what
 * is still to be found, nothing else. Deleting files is a library action, on the
 * download that brought them.
 *
 * Not an administrator's job: the list is shared, but taking something off it loses
 * nothing — anything already downloaded stays in the library, and it can be watched
 * again in two clicks. Deleting is the irreversible half, and that one is admin only.
 */
export async function DELETE(req: Request, { params }: Params) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const { id } = await params;
    const watchlistId = Number(id);

    if (! watchlistId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    try {
        const item = await getWatchlistItem(watchlistId);

        if (! item) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        const result = await stopWatching(watchlistId);
        const name = result?.media?.name || `TMDB #${ item.tmdbId }`;

        await logInfo(
            "watchlist",
            `stopped watching: ${ name }`,
            withActor(
                result ? "some of it is still watched" : "nothing is left to look for, so it came off the watchlist",
                await currentUser()
            )
        );

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
