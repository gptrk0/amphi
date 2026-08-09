import { NextRequest } from "next/server";

import { refuseUnlessAdmin } from "@/lib/auth";
import { newestLogId, onLogWritten, tailLog, toLogDto, toLogFilter } from "@/lib/log";

/**
 * The live log, over server sent events.
 *
 * **Why not a websocket.** Everything the page needs goes one way, server to browser, and
 * a websocket would need either a custom server — giving up `next dev --turbopack` — or a
 * second process that cannot see the in-process notifications this uses. `EventSource`
 * reconnects on its own and needs no dependency at all. If something bidirectional ever
 * shows up, only this file and the hook in the page change.
 *
 * **Why the connection is a cursor.** A write does not push its entry: it wakes the loop,
 * which then asks the table for everything newer than the last id it sent. So the table is
 * the only source of truth, an entry cannot arrive twice or out of order, and a line
 * written by another process — a script, a second worker — still shows up on the next
 * pass.
 */
export const dynamic = "force-dynamic";

// also the keep-alive: a proxy that drops idle connections sees traffic, and anything the
// in-process wake-up missed is picked up within this
const IDLE_MS = 15 * 1000;

/** Resolves when something is logged, when the client goes away, or on the idle tick. */
const nextChange = (signal: AbortSignal) => new Promise<void>(resolve => {
    const done = () => {
        off();
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
    };

    const off = onLogWritten(done);
    const timer = setTimeout(done, IDLE_MS);

    signal.addEventListener("abort", done);
});

export async function GET(req: NextRequest) {
    // checked once, at the handshake: the stream then lives for as long as the tab is
    // open, and a session that ends meanwhile costs an already open connection
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    const params = req.nextUrl.searchParams;
    const filter = toLogFilter(params);

    // `Last-Event-ID` is what the browser sends when it reconnects by itself, and it is
    // the id of the last frame it actually got — so a dropped connection resumes exactly
    // where it stopped instead of replaying. `after` is the first page the client already
    // has; with neither, the stream starts at "now" and can never dump the whole table.
    let cursor = Number(req.headers.get("last-event-id"))
        || Number(params.get("after"))
        || await newestLogId();

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (frame: string) => controller.enqueue(encoder.encode(frame));

            try {
                // the browser's own retry, so a restarted server is picked up in seconds
                send("retry: 3000\n\n");

                while (! req.signal.aborted) {
                    const rows = await tailLog(filter, cursor);

                    if (rows.length > 0) {
                        cursor = rows[rows.length - 1].id;

                        send(`id: ${ cursor }\nevent: entries\ndata: ${ JSON.stringify(rows.map(toLogDto)) }\n\n`);

                    } else {
                        send(": ping\n\n");
                    }

                    await nextChange(req.signal);
                }

            } catch(err) {
                // a closed connection lands here as an enqueue error, which is not news
                if (! req.signal.aborted) {
                    console.error("[log] stream failed", err);
                }
            }

            try {
                controller.close();

            } catch {
                // already closed by the client going away
            }
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            // nginx and friends buffer a response body by default, which holds every line
            // back until the buffer fills
            "X-Accel-Buffering": "no"
        }
    });
}
