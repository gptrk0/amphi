import { NextRequest } from "next/server";

import { currentUser, refuseUnlessSignedIn } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import {
    forgetDevice,
    isSubscription,
    listDevices,
    refreshDevice,
    rememberDevice,
    vapidKeys
} from "@/lib/push";

/**
 * The devices one person has asked to be told on.
 *
 * Everything here is about **the browser making the request** and nothing else. There is
 * no version of this for an administrator, and there could not be: only a browser can
 * create a push subscription, by asking the person in front of it, so nobody can turn
 * notifications on for somebody else's phone. That is the opposite of the webhook field
 * on the account page, which an administrator can fill in for a person who would rather
 * not — and the difference is in the mechanism, not in a rule anybody chose.
 */

/**
 * The list the account page shows, with the endpoints taken back out.
 *
 * An endpoint is a capability: anybody holding one can push to that phone until it is
 * revoked. The browser asking gets to know which row is *itself*, because it supplied
 * that endpoint in the question — and learns nothing about the others beyond a name it
 * chose to send and two dates.
 */
const visible = (devices: Awaited<ReturnType<typeof listDevices>>, mine: Holding) =>
    devices.map(device => ({
        id: device.id,
        label: device.label,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        current: isMine(device, mine)
    }));

/** What the browser asking is holding, which is how it finds itself in the list. */
type Holding = { deviceKey?: string, endpoint?: string };

// the key first, because that is the identity; the endpoint as well, for the one load on
// which a renewed subscription has not been written back to the row yet
const isMine = (device: { deviceKey: string, endpoint: string }, mine: Holding) =>
    (!! mine.deviceKey && device.deviceKey === mine.deviceKey)
    || (!! mine.endpoint && device.endpoint === mine.endpoint);

/**
 * The public half of the signing key, which every browser needs before it can subscribe,
 * and the list of devices this account has turned on.
 *
 * **A GET that writes**, the first time: the key pair does not exist until somebody wants
 * it, and the alternative — a key generated at install time, for a feature most installs
 * cannot use because they have no certificate — is a secret made for nobody. It happens
 * once in the life of an install and is invisible when it does.
 */
export async function GET(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const me = (await currentUser())!;
    const keys = await vapidKeys();
    const mine: Holding = {
        deviceKey: req.nextUrl.searchParams.get("deviceKey") || "",
        endpoint: req.nextUrl.searchParams.get("endpoint") || ""
    };

    const devices = await listDevices(me.id);

    return Response.json({
        success: true,
        result: {
            publicKey: keys.publicKey,
            devices: visible(devices, mine),
            // whether *this* browser is one of them, which is the switch's own state
            known: devices.some(device => isMine(device, mine))
        }
    });
}

/**
 * Two sentences through one door, and the difference between them is the whole reason the
 * device list can be trusted.
 *
 * `refresh` is what the page says on every load: *still here*. It updates a row and never
 * makes one, so a device forgotten from somewhere else stays forgotten instead of
 * re-creating itself the next time its owner opens the app.
 *
 * Without it, the switch: *turn me on*, which is the only thing that creates a row, and
 * which only ever comes from somebody pressing it.
 */
export async function POST(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const me = (await currentUser())!;
    const body = await req.json().catch(() => null);

    if (! isSubscription(body?.subscription)) {
        return Response.json({ success: false, message: "That is not a push subscription." }, { status: 400 });
    }

    const subscription = body.subscription;

    // what the browser calls itself, and the thing a row is keyed by. A hundred
    // characters is room for a uuid and not for a payload.
    const deviceKey = typeof body.deviceKey === "string" ? body.deviceKey.trim().slice(0, 100) : "";

    let known: boolean;

    if (body.refresh) {
        known = await refreshDevice(me.id, deviceKey, subscription);

    } else {
        if (! deviceKey) {
            return Response.json({ success: false, message: "That request did not say which device it is." }, { status: 400 });
        }

        // the user agent of this very request, never anything the page made up about
        // itself: it is the one description the browser has already sent
        await rememberDevice(me.id, deviceKey, subscription, req.headers.get("user-agent") || "");
        await logInfo("push", `${ me.name } turned notifications on for a device`);

        known = true;
    }

    const devices = await listDevices(me.id);

    return Response.json({
        success: true,
        result: { known, devices: visible(devices, { deviceKey, endpoint: subscription.endpoint }) }
    });
}

/**
 * One device, off. `id` is the list on the account page; `endpoint` is a browser turning
 * itself off, which is the only one it can name. Either way it has to be one of yours —
 * the lookup is scoped to the account, so an id belonging to somebody else matches
 * nothing and answers the same as an id that never existed.
 */
export async function DELETE(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const me = (await currentUser())!;
    const id = Number(req.nextUrl.searchParams.get("id")) || undefined;
    const endpoint = req.nextUrl.searchParams.get("endpoint") || undefined;

    if (! id && ! endpoint) {
        return Response.json({ success: false, message: "Which device?" }, { status: 400 });
    }

    const removed = await forgetDevice(me.id, { id, endpoint });

    if (removed > 0) {
        await logInfo("push", `${ me.name } turned notifications off for a device`);
    }

    const devices = await listDevices(me.id);

    return Response.json({
        success: true,
        result: { removed, devices: visible(devices, { endpoint }) }
    });
}
