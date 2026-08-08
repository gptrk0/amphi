import axios from "axios";

import { settingList, settingText } from "@/lib/settings";

/**
 * Telegram notifications. The point of the app is that it works while nobody is
 * watching it, which until now meant the only way to learn that something is ready
 * was to open the page and look.
 *
 * Nothing here ever throws and nothing here blocks for long: a notification that
 * fails must not take a download sync down with it.
 */

export type NotifyEvent = "ready" | "started" | "dropped";

// overridable for a self hosted Bot API server, and it is what makes this testable
// without talking to Telegram
const api = () => settingText("TELEGRAM_API_URL", "https://api.telegram.org").replace(/\/+$/, "");

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
export const notify = async (event: NotifyEvent, title: string, detail?: string) => {
    if (! isNotifyConfigured() || ! wants(event)) {
        return false;
    }

    const text = [
        `<b>${ escape(PREFIX[event]) }</b>`,
        escape(title),
        ...(detail ? [ `<i>${ escape(detail) }</i>` ] : [])
    ].join("\n");

    try {
        await axios.post(
            `${ api() }/bot${ token() }/sendMessage`,
            {
                chat_id: chatId(),
                text,
                parse_mode: "HTML",
                disable_web_page_preview: true
            },
            { timeout: TIMEOUT_MS }
        );

        return true;

    } catch(err) {
        // the message is lost, the download is not — log and carry on
        console.error("[notify] telegram send failed", axios.isAxiosError(err) ? err.response?.data || err.message : err);

        return false;
    }
};
