import axios from "axios";

import { prisma } from "@/lib/prisma";
import { errorText, logDebug, logWarn } from "@/lib/log";
import { loadSettings, settingList, settingText } from "@/lib/settings";
import { callWebhook, WebhookFields } from "@/lib/webhook";
import { NotifyEvent } from "@/types/notify";

/**
 * Telegram notifications. The point of the app is that it works while nobody is
 * watching it, which until now meant the only way to learn that something is ready
 * was to open the page and look.
 *
 * Nothing here ever throws and nothing here blocks for long: a notification that
 * fails must not take a download sync down with it.
 *
 * **Two kinds of recipient, and they no longer share a mechanism.** The Telegram chat
 * in the settings is the install's: it hears about everything the app does, and it is
 * the operator's channel. A user's own **webhook** is the other kind and hears only
 * about what that person asked for — any URL, so Telegram and Discord are both just
 * URLs and nobody has to pick a service. An administrator with both set up gets a
 * message twice, once as the operator and once as themselves; that is the honest
 * reading of it, not a bug to dedupe away.
 *
 * **The install chat is told who.** It is the one channel that hears about everybody, so
 * a line there without a name only says that something happened somewhere in the house:
 * whose download finished, who pressed the button, who deleted it. A person's own webhook
 * gets no name, because the only person it ever hears about is its owner.
 */

export type { NotifyEvent };

// overridable for a self hosted Bot API server, and it is what makes this testable
// without talking to Telegram
const api = () => settingText("TELEGRAM_API_URL").replace(/\/+$/, "");

// a hanging request must not hold up the sync round it was called from
const TIMEOUT_MS = 10 * 1000;

const ACCEPT_ALL = "*";

const token = () => settingText("TELEGRAM_BOT_TOKEN");
const chatId = () => settingText("TELEGRAM_CHAT_ID");

/**
 * Which events are wanted. No fallback, same rule as the payload lists: unset sends
 * nothing, `*` sends everything.
 */
const events = () => settingList("TELEGRAM_EVENTS").map(v => v.toLowerCase());

export const isNotifyConfigured = () => !! token() && !! chatId() && events().length > 0;

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

// Telegram parses HTML, and release names are full of characters that break it
const escape = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * `detail` is the release name or the reason — the part that answers "which one?"
 * without having to open the app. `who` is the person behind it, and only the install
 * chat is ever given one.
 */
export type NotifyMessage = { event: NotifyEvent, title: string, detail?: string, who?: string };

const body = ({ event, title, detail, who }: NotifyMessage) => [
    `<b>${ escape(PREFIX[event]) }</b>`,
    escape(title),
    ...(detail ? [ `<i>${ escape(detail) }</i>` ] : []),
    ...(who ? [ `👤 ${ escape(who) }` ] : [])
].join("\n");

/** One message to one chat. The bot token is the app's; the chat is whose it is. */
const send = async (chat: string, message: NotifyMessage, to: string) => {
    const said = `${ PREFIX[message.event] } — ${ message.title }${ message.who ? ` (${ message.who })` : "" }`;

    try {
        await axios.post(
            `${ api() }/bot${ token() }/sendMessage`,
            {
                chat_id: chat,
                text: body(message),
                parse_mode: "HTML",
                disable_web_page_preview: true
            },
            { timeout: TIMEOUT_MS }
        );

        await logDebug("notify", `telegram → ${ to }: ${ said }`, message.detail);

        return true;

    } catch(err) {
        // the message is lost, the download is not — log and carry on
        await logWarn("notify", `the telegram message to ${ to } about ${ message.title } was not sent`, errorText(err));

        return false;
    }
};

/**
 * The install chat. `who` is whose download it was or who did the thing — this channel
 * hears about everybody, so a message without it says the least interesting half.
 */
export const notify = async (event: NotifyEvent, title: string, detail?: string, who?: string) => {
    await loadSettings();

    if (! isNotifyConfigured() || ! wants(event)) {
        return false;
    }

    return await send(chatId(), { event, title, detail, who }, "the install chat");
};

const userWants = (chosen: string, event: NotifyEvent) => {
    const wanted = chosen.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);

    return wanted.includes(ACCEPT_ALL) || wanted.includes(event);
};

/** What a webhook gets, whole and in pieces — the URL decides which it uses. */
export const webhookFields = (event: NotifyEvent, title: string, detail?: string): WebhookFields => ({
    message: [ PREFIX[event], title, detail ].filter(Boolean).join(" — "),
    title,
    detail: detail || "",
    event
});

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
