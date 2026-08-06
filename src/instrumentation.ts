export async function register() {
    // the scheduler is server only, and the hook also runs for the edge runtime
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }

    if (process.env.SCAN_DISABLED === "1") {
        console.log("[scheduler] disabled by SCAN_DISABLED");

        return;
    }

    const { startScheduler } = await import("@/lib/scheduler");

    startScheduler();
}
