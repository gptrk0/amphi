import { NextRequest } from "next/server";

import { actorText, currentUser, refuseUnlessAdmin } from "@/lib/auth";
import { clearLog, logSources, logWarn, newestLogId, readLog, toLogDto, toLogFilter } from "@/lib/log";

const PAGE_SIZE = 200;

/**
 * A page of the log, newest first. `before` is the oldest id on screen, which is what
 * "load more" hands back — an offset would skip whatever arrived in the meantime.
 *
 * `newestId` is deliberately unfiltered: it is where the live stream starts, and a filter
 * that currently matches nothing must not make the stream replay the whole table.
 */
export async function GET(req: NextRequest) {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    try {
        const params = req.nextUrl.searchParams;
        const filter = toLogFilter(params);
        const before = Number(params.get("before")) || undefined;

        // one more than a page, which is how "is there more" is answered without a count
        const rows = await readLog(filter, { before, limit: PAGE_SIZE + 1 });

        return Response.json({
            success: true,
            entries: rows.slice(0, PAGE_SIZE).map(toLogDto),
            hasMore: rows.length > PAGE_SIZE,
            newestId: await newestLogId(),
            sources: await logSources()
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not read the log." }, { status: 500 });
    }
}

/** Everything, on purpose — there is nothing selective worth building here. */
export async function DELETE() {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    try {
        const count = await clearLog();

        // the log losing its own history is exactly the kind of thing the log is for,
        // and the one line that survives it had better say who
        await logWarn("app", `the log was cleared from the admin page (${ count } entries)`, actorText(await currentUser()));

        return Response.json({ success: true, cleared: count });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not clear the log." }, { status: 500 });
    }
}
