import { NextRequest } from "next/server";

import { refuseUnlessSignedIn } from "@/lib/auth";
import { getLibrary, keepRange } from "@/lib/library";
import { syncDownloadsOnce } from "@/lib/scheduler";
import { listManagedTorrents } from "@/lib/torrent";

export async function GET(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    // only the table asks for this, it costs a qBittorrent call
    const live = req.nextUrl.searchParams.get('live') === "1";

    try {
        const torrents = live ? await listManagedTorrents() : null;

        // the same list the rows are drawn from also finishes them: whoever is
        // watching the table sees a download flip to available in seconds instead
        // of waiting for the next scheduled round
        if (torrents) {
            await syncDownloadsOnce(torrents);
        }

        // the range comes with the list: the floor of a retention is the seed time, and
        // that is a setting the page has no other way of knowing
        return Response.json({ success: true, result: await getLibrary(torrents), keepRange: keepRange() });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to load the library!' }, { status: 500 });
    }
}
