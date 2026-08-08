import {
    deleteSetting,
    isSecret,
    loadSettings,
    SETTING_GROUPS,
    SETTINGS,
    saveSettings,
    settingDef,
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
        ordered: !! def.ordered,
        help: def.help || "",
        placeholder: def.placeholder || "",
        // shown as "back to X" on the reset button, so it is worth knowing even when the
        // saved value is what is in the field
        default: def.default ?? "",
        hasDefault: def.default !== undefined,
        source,
        // where it comes from is worth showing even for a secret; the value is not
        value: def.secret ? "" : settingText(key),
        isSet: source !== "unset"
    };
};

const state = () => ({ groups: SETTING_GROUPS, settings: SETTINGS.map(def => toItem(def.key)) });

export async function GET() {
    try {
        await loadSettings(true);

        return Response.json({ success: true, ...state() });

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

        const wanted: Record<string, string> = {};

        for (const [ key, value ] of Object.entries(values as Record<string, unknown>)) {
            const def = settingDef(key);

            if (! def) {
                continue;
            }

            const text = (typeof value === "string" ? value : String(value ?? "")).trim();

            // an untouched secret arrives as an empty string, and empty would mean "back
            // to nothing" — so those are dropped rather than wiping a key nobody meant
            // to change. Clearing one is the separate DELETE below
            if (isSecret(key) && text === "") {
                continue;
            }

            // a number that is not one would silently become the default on the next
            // read, so it is refused here instead
            if (def.type === "number" && text !== "" && ! Number.isFinite(Number(text))) {
                return Response.json({
                    success: false,
                    message: `${ def.label } has to be a number.`
                }, { status: 400 });
            }

            wanted[key] = text;
        }

        const changed = await saveSettings(wanted);

        return Response.json({ success: true, changed: changed.length, ...state() });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not save the settings." }, { status: 500 });
    }
}

/**
 * Back to the default. Also the only way to clear a secret, for the same reason an empty
 * field cannot mean it.
 */
export async function DELETE(req: Request) {
    try {
        const key = new URL(req.url).searchParams.get("key");

        if (! key || ! (await deleteSetting(key))) {
            return Response.json({ success: false, message: "Unknown setting." }, { status: 400 });
        }

        return Response.json({ success: true, ...state() });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not clear the setting." }, { status: 500 });
    }
}
