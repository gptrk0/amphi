import {
    isSecret,
    loadSettings,
    SETTING_GROUPS,
    SETTINGS,
    saveSettings,
    settingSource,
    settingText
} from "@/lib/settings";

/**
 * A secret is never sent back. The page shows whether one is set and lets it be
 * replaced, which is enough to administer it without the value ever leaving the
 * server — the app has no login yet, and a form that renders the qBittorrent password
 * would hand it to anyone who can reach the page.
 */
const toItem = (key: string) => {
    const def = SETTINGS.find(entry => entry.key === key)!;
    const source = settingSource(key);

    return {
        key: def.key,
        group: def.group,
        label: def.label,
        type: def.type,
        secret: !! def.secret,
        help: def.help || "",
        placeholder: def.placeholder || "",
        source,
        // where it comes from is worth showing even for a secret; the value is not
        value: def.secret ? "" : settingText(key),
        isSet: source !== "unset"
    };
};

export async function GET() {
    try {
        await loadSettings(true);

        return Response.json({
            success: true,
            groups: SETTING_GROUPS,
            settings: SETTINGS.map(def => toItem(def.key))
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not read the settings." }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    try {
        const body = await req.json().catch(() => null);
        const values = body?.values;

        if (! values || typeof values !== "object") {
            return Response.json({ success: false, message: "Nothing to save." }, { status: 400 });
        }

        // an untouched secret arrives as an empty string, and empty means "clear it" —
        // so those are dropped rather than wiping a key nobody meant to change
        const wanted: Record<string, string> = {};

        for (const [ key, value ] of Object.entries(values as Record<string, unknown>)) {
            const text = typeof value === "string" ? value : String(value ?? "");

            if (isSecret(key) && text.trim() === "") {
                continue;
            }

            wanted[key] = text;
        }

        const changed = await saveSettings(wanted);

        return Response.json({
            success: true,
            changed: changed.length,
            groups: SETTING_GROUPS,
            settings: SETTINGS.map(def => toItem(def.key))
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not save the settings." }, { status: 500 });
    }
}

/**
 * Clearing a secret is a separate, explicit action for the same reason: an empty field
 * cannot mean it.
 */
export async function DELETE(req: Request) {
    try {
        const key = new URL(req.url).searchParams.get("key");

        if (! key || ! SETTINGS.some(def => def.key === key)) {
            return Response.json({ success: false, message: "Unknown setting." }, { status: 400 });
        }

        await saveSettings({ [key]: "" });

        return Response.json({
            success: true,
            groups: SETTING_GROUPS,
            settings: SETTINGS.map(def => toItem(def.key))
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not clear the setting." }, { status: 500 });
    }
}
