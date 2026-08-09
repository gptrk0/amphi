import { currentUser, refuseUnlessAdmin, withActor } from "@/lib/auth";
import { logInfo, logWarn } from "@/lib/log";
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
 * server. Everything here is administrators only now, which is a reason to relax this
 * and not a good one: a rendered password is one shoulder, one screen share or one
 * cached response away from being somebody else's.
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

// a long list would push everything else out of the line
const clip = (value: string) => value.length > 120 ? `${ value.slice(0, 119) }…` : value;

/**
 * A changed setting is worth a log line: half of what looks like a broken app is
 * something that was edited here. A secret is named, never quoted — the log page is as
 * public as this one is, which is to say anyone who can reach it.
 */
const change = (key: string, before: string, after: string) => {
    if (isSecret(key)) {
        return before === "" ? "set for the first time" : "replaced";
    }

    return `"${ clip(before) }" → "${ clip(after) }"`;
};

const name = (key: string) => {
    const def = settingDef(key);

    return def ? `${ def.group } / ${ def.label } (${ key })` : key;
};

export async function GET() {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    try {
        await loadSettings(true);

        return Response.json({ success: true, ...state() });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not read the settings." }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

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

        // read before the save, or the "from" half of every line would be the new value
        const before = Object.fromEntries(Object.keys(wanted).map(key => [ key, settingText(key) ]));

        const changed = await saveSettings(wanted);
        const who = await currentUser();

        for (const key of changed) {
            await logInfo("settings", `setting changed: ${ name(key) }`, withActor(change(key, before[key], wanted[key]), who));
        }

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
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    try {
        const key = new URL(req.url).searchParams.get("key");

        if (! key || ! (await deleteSetting(key))) {
            return Response.json({ success: false, message: "Unknown setting." }, { status: 400 });
        }

        const def = settingDef(key);

        // a warning, not a note: a misclick here once cost the indexer api key, and this
        // line is what would have said where the searches went
        await logWarn(
            "settings",
            `setting cleared: ${ name(key) }`,
            withActor(
                def?.default !== undefined ? `back to the default "${ clip(def.default) }"` : "it has no default, so it is unset now",
                await currentUser()
            )
        );

        return Response.json({ success: true, ...state() });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not clear the setting." }, { status: 500 });
    }
}
