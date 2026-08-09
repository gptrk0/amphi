import { currentUser, refuseUnlessSignedIn, withActor } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import { getWatchlistItem, stopWatching, toMediaType } from "@/lib/watchlist";

type Params = { params: Promise<{ id: string }> };

/**
 * Stop watching, which is all a watchlist row can be asked to do now: it holds what
 * is still to be found, nothing else. Deleting files is a library action, on the
 * download that brought them.
 *
 * A row belongs to somebody, and only they can take it off — plus an administrator,
 * who is the one person who can clear up after somebody who left. Deleting files is
 * a library action, and that one is administrators only for everybody.
 */
export async function DELETE(req: Request, { params }: Params) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const { id } = await params;
    const watchlistId = Number(id);
    const me = (await currentUser())!;

    if (! watchlistId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    try {
        const item = await getWatchlistItem(watchlistId);

        if (! item) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        // 404 and not 403: whether somebody else is watching something is not this
        // endpoint's to tell
        if (item.userId !== me.id && ! me.isAdmin) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        const result = await stopWatching(watchlistId);
        const name = result?.media?.name || `TMDB #${ item.tmdbId }`;

        await logInfo(
            "watchlist",
            `stopped watching: ${ name }`,
            withActor(
                [
                    result ? "some of it is still watched" : "nothing is left to look for, so it came off the watchlist",
                    item.userId === me.id ? "" : `off ${ item.user.name }'s list`
                ].filter(Boolean).join(", "),
                me
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
