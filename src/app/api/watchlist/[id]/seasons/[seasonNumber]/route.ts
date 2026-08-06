import { setSeasonMonitored } from "@/lib/watchlist";

type Params = { params: Promise<{ id: string, seasonNumber: string }> };

export async function PATCH(req: Request, { params }: Params) {
    let { id, seasonNumber } = await params;

    let watchlistId = Number(id);
    let season = Number(seasonNumber);

    if (! watchlistId || Number.isNaN(season)) {
        return Response.json({ success: false, message: 'Invalid id or season number!' }, { status: 400 });
    }

    try {
        let body = await req.json();

        if (typeof body?.monitored !== "boolean") {
            return Response.json({ success: false, message: 'Missing monitored flag!' }, { status: 400 });
        }

        let result = await setSeasonMonitored(watchlistId, season, body.monitored);

        return Response.json({ success: true, result });

    } catch(err: any) {
        // Prisma: no such season for this watchlist item
        if (err?.code === "P2025") {
            return Response.json({ success: false, message: 'Season not found!' }, { status: 404 });
        }

        console.error(err);

        return Response.json({ success: false, message: 'Failed to update season!' }, { status: 500 });
    }
}
