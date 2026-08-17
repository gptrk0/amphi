import { prisma } from "@/lib/prisma";
import { logDebug, logWarn } from "@/lib/log";
import { loadSettings, settingList, settingText } from "@/lib/settings";
import { callWebhook, WebhookFields } from "@/lib/webhook";
import { NotifyEvent } from "@/types/notify";

/**
 * Notifications. The point of the app is that it works while nobody is watching it,
 * which until now meant the only way to learn that something is ready was to open the
 * page and look.
 *
 * Nothing here ever throws and nothing here blocks for long: a notification that
 * fails must not take a download sync down with it.
 *
 * **Two kinds of recipient, one mechanism.** The install's channel hears about everything
 * the app does and is the operator's; a person's own hears only about what they asked for.
 * Both are a **webhook URL** — the install's was a Telegram bot token, a chat id and a bot
 * api url until 2026-08-17, which was three fields that only one service could ever use,
 * while the accounts had had the general answer since 2026-08-09. An administrator with
 * both set up gets a message twice, once as the operator and once as themselves; that is
 * the honest reading of it, not a bug to dedupe away.
 *
 * **The install channel is told who.** It is the one that hears about everybody, so a line
 * there without a name only says that something happened somewhere in the house: whose
 * download finished, who pressed the button, who deleted it. A person's own webhook gets no
 * name, because the only person it ever hears about is its owner.
 */

export type { NotifyEvent };

const ACCEPT_ALL = "*";

const url = () => settingText("NOTIFY_WEBHOOK_URL").trim();

/**
 * Which events are wanted. No fallback, same rule as the payload lists: unset sends
 * nothing, `*` sends everything.
 */
const events = () => settingList("NOTIFY_EVENTS").map(v => v.toLowerCase());

export const isNotifyConfigured = () => !! url() && events().length > 0;

const wants = (event: NotifyEvent) => {
    const wanted = events();

    return wanted.includes(ACCEPT_ALL) || wanted.includes(event);
};

const PREFIX: Record<NotifyEvent, string> = {
    ready: "✅ Ready to watch",
    started: "⬇️ Download started",
    dropped: "⚠️ Release dropped",
    deleted: "🗑 Deleted"
};

/**
 * `detail` is the release name or the reason — the part that answers "which one?"
 * without having to open the app. `who` is the person behind it, and only the install
 * channel is ever given one.
 */
export type NotifyMessage = { event: NotifyEvent, title: string, detail?: string, who?: string };

/**
 * The install channel. `who` is whose download it was or who did the thing — this channel
 * hears about everybody, so a message without it says the least interesting half.
 */
export const notify = async (event: NotifyEvent, title: string, detail?: string, who?: string) => {
    await loadSettings();

    if (! isNotifyConfigured() || ! wants(event)) {
        return false;
    }

    const fields = webhookFields(event, title, detail, who);
    const result = await callWebhook(url(), fields);

    if (result.ok) {
        await logDebug("notify", `webhook → the install: ${ fields.message }`, detail);

        return true;
    }

    // the message is lost, the download is not — log and carry on. No url in the line: it
    // is the one setting whose value is a secret, and `scrub` only catches the shapes it
    // knows about
    await logWarn("notify", `the install's webhook did not take the message about ${ title }`, result.error);

    return false;
};

const userWants = (chosen: string, event: NotifyEvent) => {
    const wanted = chosen.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);

    return wanted.includes(ACCEPT_ALL) || wanted.includes(event);
};

/**
 * What a webhook gets, whole and in pieces — the URL decides which it uses.
 *
 * `who` is folded into `message` as well as standing on its own, because most URLs only
 * carry `{message}` (or nothing at all, and then the whole message is the JSON body): the
 * name has to be in the sentence or the install channel loses the half that makes it worth
 * reading. A person's own webhook passes none, and comes out exactly as it did before.
 */
export const webhookFields = (event: NotifyEvent, title: string, detail?: string, who?: string): WebhookFields => ({
    message: [ PREFIX[event], title, detail, who ].filter(Boolean).join(" — "),
    title,
    detail: detail || "",
    event,
    who: who || ""
});

/**
 * One message, now, to a URL somebody is looking at. Worth having at all because the
 * alternative is finding out weeks later that the URL had a typo — the real ones only fire
 * when a download lands, and a webhook that silently fails looks exactly like one that was
 * never going to be needed.
 *
 * The wording lives here rather than in the two routes that call it: the account page and
 * the settings page ask the same question and should not answer it in two dialects. `said`
 * is the same outcome for a log line, which each caller writes in its own words.
 */
export const testWebhookUrl = async (target: string) => {
    const result = await callWebhook(target, webhookFields("ready", "A test from Amphi", "if you can read this, it works"));

    return {
        ok: result.ok,
        status: result.ok ? 200 : 502,
        message: result.ok ? "Sent — go and look." : `It did not go through: ${ result.error }`,
        said: result.ok ? "it went through" : `it failed: ${ result.error }`
    };
};

/**
 * "Anna", "Anna and Patrick" — the names behind a download, for the one channel that
 * hears about everybody's. An account that has since been deleted drops out rather than
 * being printed as a number, and nobody at all comes back empty: an instant download
 * whose asker was removed really is nobody's.
 */
export const nameList = async (userIds: number[]) => {
    if (userIds.length === 0) {
        return "";
    }

    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { name: true },
        orderBy: { name: "asc" }
    });

    const names = users.map(user => user.name);

    if (names.length < 2) {
        return names[0] || "";
    }

    return `${ names.slice(0, -1).join(", ") } and ${ names[names.length - 1] }`;
};

/** The same, as the install chat reads it. Undefined when there is nobody to name. */
export const forWhom = async (userIds: number[]) => {
    const names = await nameList(userIds);

    return names ? `for ${ names }` : undefined;
};

/**
 * The people who asked for this one thing. Nobody is told about somebody else's
 * download — that is the whole reason a watchlist belongs to a person now.
 *
 * Nothing in the settings gates this: a webhook is the user's own address and needs
 * no bot token, so somebody can have notifications working on an install where the
 * operator never set one up.
 */
export const notifyUsers = async (userIds: number[], event: NotifyEvent, title: string, detail?: string) => {
    await loadSettings();

    if (userIds.length === 0) {
        return 0;
    }

    const users = await prisma.user.findMany({
        where: { id: { in: userIds }, disabled: false, webhookUrl: { not: null } },
        select: { name: true, webhookUrl: true, notifyEvents: true }
    });

    const fields = webhookFields(event, title, detail);
    let sent = 0;

    for (const user of users) {
        if (! userWants(user.notifyEvents, event)) {
            continue;
        }

        const result = await callWebhook(user.webhookUrl!, fields);

        if (result.ok) {
            sent++;

            await logDebug("notify", `webhook → ${ user.name }: ${ PREFIX[event] } — ${ title }`, detail);

        } else {
            // the message is lost, the download is not
            await logWarn("notify", `${ user.name }'s webhook did not take the message about ${ title }`, result.error);
        }
    }

    return sent;
};
