import { NextRequest } from "next/server";

import { currentUser, refuseUnlessSignedIn } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import { deviceCount, forgetDevice, isSubscription, rememberDevice, vapidKeys } from "@/lib/push";

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
 * The public half of the signing key, which every browser needs before it can subscribe.
 *
 * **A GET that writes**, the first time: the pair does not exist until somebody wants it,
 * and the alternative — a key generated at install time, for a feature most installs
 * cannot use because they have no certificate — is a secret made for nobody. It happens
 * once in the life of an install and is invisible when it does.
 */
export async function GET() {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const me = (await currentUser())!;
    const keys = await vapidKeys();

    return Response.json({
        success: true,
        result: {
            publicKey: keys.publicKey,
            // what this account has anywhere, not what this browser has: the page knows
            // its own subscription already and this is the other half of the sentence
            devices: await deviceCount(me.id)
        }
    });
}

/**
 * Remembers this browser, and is meant to be called on every load rather than once. The
 * endpoint is the identity, so repeating it costs a row update — and it is what lets a
 * device quietly reappear after the browser renewed its subscription behind everybody's
 * back, which is a thing browsers do.
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

    const known = await deviceCount(me.id);

    // the user agent, shortened to something a person would recognise. Never anything
    // the browser did not already send with this request.
    const label = typeof body.label === "string" ? body.label : req.headers.get("user-agent") || "";

    await rememberDevice(me.id, body.subscription, label);

    const now = await deviceCount(me.id);

    // only the new ones are worth a line: the re-registration on every load would
    // otherwise write the log full of nothing
    if (now > known) {
        await logInfo("push", `${ me.name } turned notifications on for a device`, label || undefined);
    }

    return Response.json({ success: true, result: { devices: now } });
}

/** This browser, off. Only ever your own: the endpoint has to be one of yours. */
export async function DELETE(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const me = (await currentUser())!;
    const endpoint = req.nextUrl.searchParams.get("endpoint") || "";

    if (! endpoint) {
        return Response.json({ success: false, message: "Which device?" }, { status: 400 });
    }

    const removed = await forgetDevice(me.id, endpoint);

    if (removed > 0) {
        await logInfo("push", `${ me.name } turned notifications off for a device`);
    }

    return Response.json({ success: true, result: { devices: await deviceCount(me.id) } });
}
