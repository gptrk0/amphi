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
 * **A secret comes back too.** It used to be withheld — the page said whether one was set
 * and let it be replaced, never read. What that bought was one attack (a screen share, a
 * cached response) that this page is already wide open to, since it is administrators
 * only and they are the ones who typed the key in the first place. What it cost was the
 * everyday question: is the key in there the same one the indexer is rejecting? That was
 * unanswerable without a database shell, and a field you cannot read is a field you
 * retype from a password manager to check. So the value is sent, and `secret` now only
 * means one thing: the **log** names the setting instead of quoting it, because a log page
 * is read by people who are not looking for it and shows up in screenshots.
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
        options: def.options ?? [],
        help: def.help || "",
        placeholder: def.placeholder || "",
        // shown as "back to X" on the reset button, so it is worth knowing even when the
        // saved value is what is in the field
        default: def.default ?? "",
        hasDefault: def.default !== undefined,
        source,
        value: settingText(key),
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
        return after === "" ? "cleared" : before === "" ? "set for the first time" : "replaced";
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
 * Back to the default, which is a different gesture from saving an empty value — for a
 * list, empty is a decision and is stored. A secret can now also be cleared by emptying
 * its field, since the field holds the real value and emptying it is deliberate; this is
 * still the only way to get a *default* back.
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
