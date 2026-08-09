import axios from "axios";

import { prisma } from "@/lib/prisma";
import { errorText, logDebug, logWarn } from "@/lib/log";
import { loadSettings, settingList, settingText } from "@/lib/settings";

/**
 * Telegram notifications. The point of the app is that it works while nobody is
 * watching it, which until now meant the only way to learn that something is ready
 * was to open the page and look.
 *
 * Nothing here ever throws and nothing here blocks for long: a notification that
 * fails must not take a download sync down with it.
 *
 * **Two kinds of recipient.** The chat in the settings is the install's: it hears
 * about everything the app does, and it is the operator's channel. A user's own chat
 * id is the other kind and hears only about what that person asked for. They share
 * one bot token — the token is the app's, the chat is whose it is — so an
 * administrator with both configured gets a message twice, once as the operator and
 * once as themselves. That is the honest reading of it, not a bug to dedupe away.
 */

export type NotifyEvent = "ready" | "started" | "dropped";

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
    dropped: "⚠️ Release dropped"
};

// Telegram parses HTML, and release names are full of characters that break it
const escape = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * `detail` is the release name or the reason — the part that answers "which one?"
 * without having to open the app.
 */
const body = (event: NotifyEvent, title: string, detail?: string) => [
    `<b>${ escape(PREFIX[event]) }</b>`,
    escape(title),
    ...(detail ? [ `<i>${ escape(detail) }</i>` ] : [])
].join("\n");

/** One message to one chat. The bot token is the app's; the chat is whose it is. */
const send = async (chat: string, event: NotifyEvent, title: string, detail: string | undefined, who: string) => {
    try {
        await axios.post(
            `${ api() }/bot${ token() }/sendMessage`,
            {
                chat_id: chat,
                text: body(event, title, detail),
                parse_mode: "HTML",
                disable_web_page_preview: true
            },
            { timeout: TIMEOUT_MS }
        );

        await logDebug("notify", `telegram → ${ who }: ${ PREFIX[event] } — ${ title }`, detail);

        return true;

    } catch(err) {
        // the message is lost, the download is not — log and carry on
        await logWarn("notify", `the telegram message to ${ who } about ${ title } was not sent`, errorText(err));

        return false;
    }
};

export const notify = async (event: NotifyEvent, title: string, detail?: string) => {
    await loadSettings();

    if (! isNotifyConfigured() || ! wants(event)) {
        return false;
    }

    return await send(chatId(), event, title, detail, "the install chat");
};

const userWants = (chosen: string, event: NotifyEvent) => {
    const wanted = chosen.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);

    return wanted.includes(ACCEPT_ALL) || wanted.includes(event);
};

/**
 * The people who asked for this one thing. Nobody is told about somebody else's
 * download — that is the whole reason a watchlist belongs to a person now.
 *
 * The bot token still comes from the settings, so an install with no bot notifies
 * nobody however many chat ids are filled in.
 */
export const notifyUsers = async (userIds: number[], event: NotifyEvent, title: string, detail?: string) => {
    await loadSettings();

    if (! token() || userIds.length === 0) {
        return 0;
    }

    const users = await prisma.user.findMany({
        where: { id: { in: userIds }, disabled: false, telegramChatId: { not: null } },
        select: { name: true, telegramChatId: true, telegramEvents: true }
    });

    let sent = 0;

    for (const user of users) {
        if (! userWants(user.telegramEvents, event)) {
            continue;
        }

        if (await send(user.telegramChatId!, event, title, detail, user.name)) {
            sent++;
        }
    }

    return sent;
};
