// named imports and not a default one: `web-push` is CommonJS with no `default` on it,
// which typescript is happy to pretend otherwise about and bun refuses outright — the
// development server would not start, with the error pointing at the module rather than
// at the import that was wrong
import { generateVAPIDKeys, sendNotification } from "web-push";

import { prisma } from "@/lib/prisma";
import { logDebug, logWarn } from "@/lib/log";
import { loadSettings, settingText } from "@/lib/settings";

/**
 * A notification that arrives on the phone itself, with no second app in the middle.
 *
 * **Why this exists next to the webhooks.** A webhook needs a service that already has
 * the person's attention — Telegram, Discord, ntfy — and every one of them is somebody
 * else's app to install and sign into. A web push goes to the browser that is already
 * running this page, which on a home screen *is* the app. The webhooks stay: they are
 * the only thing that works without https, and an install reached as a plain address on
 * the house network cannot have this at all.
 *
 * **What leaves the machine, honestly.** The message is encrypted to keys the browser
 * generated and this server never chose, so Apple, Google and Mozilla carry a sealed
 * envelope. What they do learn is that this install sent something to that device at
 * that moment. That is more than the rest of the app gives away, and it is the price of
 * a notification that arrives while nothing is running — stated here rather than in a
 * README nobody reads, because it is the one thing about this worth deciding.
 *
 * **No account anywhere.** A VAPID key pair is not a registration: it is how the push
 * services recognise that two messages came from the same sender. It is generated here,
 * on first use, and the only cost of losing it is that every device has to be turned on
 * again.
 */

export type PushPayload = {
    title: string;
    body: string;
    /// where tapping it goes, relative to the app
    url?: string;
    /// notifications sharing a tag replace each other instead of stacking up
    tag?: string;
};

/**
 * The `sub` claim every push service wants: a way to reach whoever is sending, if the
 * sending ever becomes a problem for them.
 *
 * **It is the project's address and never the operator's.** The obvious thing to put
 * here is the administrator's email, and the obvious thing is wrong: it would hand a
 * household's email address to Apple and Google on every notification, which is exactly
 * what an install that keeps its library to itself should not do.
 */
const SUBJECT = "https://github.com/gptrk0/amphi";

/**
 * How long a push service holds the message for a phone that is off. Long enough to
 * survive a night, short enough that nothing arrives so late that it has stopped being
 * true — a download that finished yesterday does not need to buzz tomorrow.
 */
const TTL_SECONDS = 12 * 60 * 60;

/**
 * The key pair, made the first time anybody asks for it.
 *
 * `createMany` with `skipDuplicates` rather than an upsert, because two browsers turning
 * notifications on at the same moment would otherwise each write their own pair and the
 * second would silently break the first. Here the loser of that race writes nothing and
 * both read back whatever landed.
 */
export const vapidKeys = async () => {
    await loadSettings();

    const existing = {
        publicKey: settingText("PUSH_VAPID_PUBLIC"),
        privateKey: settingText("PUSH_VAPID_PRIVATE")
    };

    if (existing.publicKey && existing.privateKey) {
        return existing;
    }

    const made = generateVAPIDKeys();

    await prisma.setting.createMany({
        data: [
            { key: "PUSH_VAPID_PUBLIC", value: made.publicKey },
            { key: "PUSH_VAPID_PRIVATE", value: made.privateKey }
        ],
        skipDuplicates: true
    });

    await loadSettings(true);

    await logDebug("push", "a signing key pair was generated for this install");

    return {
        publicKey: settingText("PUSH_VAPID_PUBLIC"),
        privateKey: settingText("PUSH_VAPID_PRIVATE")
    };
};

/** What the browser hands over when its user says yes. */
export type Subscription = {
    endpoint: string;
    keys: { p256dh: string, auth: string };
};

export const isSubscription = (value: unknown): value is Subscription => {
    const subscription = value as Subscription;

    return !! subscription
        && typeof subscription.endpoint === "string"
        && /^https:\/\//.test(subscription.endpoint)
        && !! subscription.keys
        && typeof subscription.keys.p256dh === "string"
        && typeof subscription.keys.auth === "string";
};

/**
 * Remembering a device, and remembering it again. The client re-registers on every load
 * rather than asking whether it is known: the endpoint is the identity, so saying it
 * twice is free, and it is what makes a device whose subscription was restored from a
 * backup — or a database that was — quietly correct itself instead of going silent.
 */
export const rememberDevice = async (userId: number, subscription: Subscription, label?: string) => {
    const data = {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        label: label?.slice(0, 120) || null
    };

    await prisma.pushDevice.upsert({
        where: { endpoint: subscription.endpoint },
        // the owner is updated too: a shared phone that somebody else signs into keeps
        // the same endpoint, and it must stop being the first person's
        update: { ...data, lastSeenAt: new Date() },
        create: data
    });
};

export const forgetDevice = async (userId: number, endpoint: string) => {
    return (await prisma.pushDevice.deleteMany({ where: { userId, endpoint } })).count;
};

export const deviceCount = async (userId: number) => await prisma.pushDevice.count({ where: { userId } });

/**
 * Sends it, to every device one person has, and never throws — the contract the
 * webhooks already keep, for the same reason: a notification that fails must not take a
 * download sync down with it.
 *
 * A 404 or a 410 is not a failure to retry. It is the push service saying this
 * subscription no longer exists — the app was taken off the home screen, the browser's
 * storage was cleared — and the only correct answer is to forget the row.
 */
export const pushToUser = async (userId: number, payload: PushPayload) => {
    const devices = await prisma.pushDevice.findMany({ where: { userId } });

    if (devices.length === 0) {
        return 0;
    }

    const keys = await vapidKeys();

    if (! keys.publicKey || ! keys.privateKey) {
        return 0;
    }

    const body = JSON.stringify(payload);
    let sent = 0;

    for (const device of devices) {
        try {
            await sendNotification(
                { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
                body,
                {
                    TTL: TTL_SECONDS,
                    vapidDetails: { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey }
                }
            );

            sent++;

        } catch(err) {
            const status = (err as { statusCode?: number }).statusCode;

            if (status === 404 || status === 410) {
                await prisma.pushDevice.delete({ where: { id: device.id } }).catch(() => {});
                await logDebug("push", "a device stopped existing and was forgotten", device.label || undefined);

                continue;
            }

            // the endpoint stays out of the line: it is a capability, and anybody
            // holding it can push to that phone
            await logWarn("push", `a device did not take the message about ${ payload.title }`, String(status || "no status"));
        }
    }

    return sent;
};

/** One message, now, to the devices somebody is looking at. The account page's button. */
export const testPush = async (userId: number) => {
    const devices = await deviceCount(userId);

    if (devices === 0) {
        return { ok: false, message: "No device here has notifications turned on yet." };
    }

    const sent = await pushToUser(userId, {
        title: "A test from Amphi",
        body: "If you can read this, it works.",
        url: "/",
        tag: "test"
    });

    return sent > 0
        ? { ok: true, message: `Sent to ${ sent } of ${ devices } — go and look.` }
        : { ok: false, message: "It did not go through. The log under Settings has the reason." };
};
