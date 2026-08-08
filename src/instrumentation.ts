export async function register() {
    // the scheduler is server only, and the hook also runs for the edge runtime
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }

    // every setting is read synchronously from a cache of the table, so the table has to
    // be in memory before the first request is served — nothing else answers those keys
    const { loadSettings } = await import("@/lib/settings");

    await loadSettings(true);

    if (process.env.SCAN_DISABLED === "1") {
        console.log("[scheduler] disabled by SCAN_DISABLED");

        return;
    }

    const { startScheduler } = await import("@/lib/scheduler");

    await startScheduler();
}
