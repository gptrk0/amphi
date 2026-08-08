export async function register() {
    // the scheduler is server only, and the hook also runs for the edge runtime
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }

    // every setting is read synchronously from a cache of the table, so the table has to
    // be in memory before the first request is served — nothing else answers those keys
    const { loadSettings } = await import("@/lib/settings");

    await loadSettings(true);

    // imported down here for the same reason: the log module reaches the database
    const { logInfo, logWarn } = await import("@/lib/log");

    // where the log starts after a restart, which is the question every unexplained gap
    // in it turns out to be
    await logInfo("app", "the server started");

    if (process.env.SCAN_DISABLED === "1") {
        await logWarn("app", "the scanner is off: SCAN_DISABLED=1 in the environment, nothing is searched or downloaded on its own");

        return;
    }

    const { startScheduler } = await import("@/lib/scheduler");

    await startScheduler();
}
