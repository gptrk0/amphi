import { currentUser, refuseUnlessAdmin, withActor } from "@/lib/auth";
import { diagnoseWatchlistRow } from "@/lib/diagnose";
import { isIndexerConfigured } from "@/lib/indexer";
import { logInfo } from "@/lib/log";

type Params = { params: Promise<{ id: string }> };

/**
 * Why this row found nothing — the scanner's search run again, with every check it put
 * each release through written down. See `diagnoseWatchlistRow`.
 *
 * **Administrators only, and not because the answer is secret.** It reads a row that is
 * usually somebody else's, it names the indexers the install talks to, and running it
 * queries every one of them at once — the same reason the "Scan now" button next to it is
 * an administrator's. A `GET` even so: it starts nothing, writes nothing and changes
 * nothing, and the one thing it leaves behind is the log line below, which is there
 * because an unexplained burst of indexer traffic should have a name on it.
 */
export async function GET(req: Request, { params }: Params) {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    const { id } = await params;
    const watchlistId = Number(id);

    if (! watchlistId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    // with no indexer there is nothing to ask and nothing to explain, and an empty
    // diagnosis would read as "every indexer answered nothing"
    if (! isIndexerConfigured()) {
        return Response.json({
            success: false,
            message: 'No indexer is configured, so there is nothing to search (Settings / Indexers).'
        }, { status: 409 });
    }

    try {
        const result = await diagnoseWatchlistRow(watchlistId);

        if (! result) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        const accepted = result.lines.reduce((sum, line) => sum + line.accepted, 0);
        const found = result.lines.reduce((sum, line) => sum + line.found, 0);

        await logInfo(
            "indexer",
            `search checked by hand: ${ result.name }`,
            withActor(
                `${ result.lines.length } line${ result.lines.length === 1 ? "" : "s" }, ${ found } result${ found === 1 ? "" : "s" }, ${ accepted } of them acceptable`,
                await currentUser()
            )
        );

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Could not check the search!' }, { status: 500 });
    }
}
