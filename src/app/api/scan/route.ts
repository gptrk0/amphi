import { runScan } from "@/lib/scheduler";

export async function POST() {
    try {
        const started = await runScan();

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
