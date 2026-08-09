import { refuseUnlessAdmin, refuseUnlessSignedIn } from "@/lib/auth";
import { isScanRunning, nextScanAt, runScan } from "@/lib/scheduler";
import { loadSettings, settingFlag, settingNumber } from "@/lib/settings";

/** When the next round is due, so the page can count down instead of guessing. */
export async function GET() {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    await loadSettings();

    return Response.json({
        success: true,
        nextScanAt: nextScanAt(),
        intervalMinutes: settingNumber("WATCHLIST_SCAN_INTERVAL_MINUTES"),
        running: isScanRunning(),
        dryRun: settingFlag("SCAN_DRY_RUN")
    });
}

/**
 * Starting a round is an operator's button, so it is an administrator's: it hits every
 * indexer at once, and an indexer that is being hammered starts refusing everybody.
 * The countdown above is not — it is on the watchlist page, which everybody sees.
 */
export async function POST(req: Request) {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    try {
        // `force` is the button on the watchlist: check everything monitored now,
        // ignoring the backoff. release dates are never ignored. no body means a
        // plain scheduled round.
        const body = await req.json().catch(() => null);
        const force = body?.force === true;

        const started = await runScan({ force });

        await loadSettings();

        return Response.json({
            success: true,
            dryRun: settingFlag("SCAN_DRY_RUN"),
            // the round it just ran pushed the next one a full interval away
            nextScanAt: nextScanAt(),
            message: started ? "Scan finished." : "A scan is already running."
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Scan failed!" }, { status: 500 });
    }
}
