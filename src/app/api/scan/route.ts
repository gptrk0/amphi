import { runScan } from "@/lib/scheduler";

export async function POST(req: Request) {
    try {
        // `force` is the button on the watchlist: check everything monitored now,
        // ignoring the backoff. release dates are never ignored. no body means a
        // plain scheduled round.
        const body = await req.json().catch(() => null);
        const force = body?.force === true;

        const started = await runScan({ force });

        return Response.json({
            success: true,
            dryRun: process.env.SCAN_DRY_RUN === "1",
            message: started ? "Scan finished." : "A scan is already running."
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Scan failed!" }, { status: 500 });
    }
}
