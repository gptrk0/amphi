import axios from "axios";

import { errorText } from "@/lib/log";
import { settingFlag } from "@/lib/settings";

/**
 * A notification to a URL somebody pasted in.
 *
 * **One field, two shapes.** Telegram's `sendMessage` is a GET with the text in the
 * query string; a Discord webhook is a POST with the text in a JSON body. Rather than
 * ask which service it is, the URL says: **a placeholder in it means the text goes in
 * the URL**, and no placeholder means it goes in the body. So both of these work, and
 * neither needs a service picker:
 *
 *     https://api.telegram.org/bot<token>/sendMessage?chat_id=123&text={message}
 *     https://discord.com/api/webhooks/<id>/<token>
 *
 * **Why this is guarded.** The server fetches a URL that any signed in user chose,
 * which is a server side request forgery primitive if left alone — the app can reach
 * the qBittorrent API, the Postgres host and its own admin endpoints, and none of
 * those are reachable from the user's browser. So a private or loopback address is
 * refused unless an administrator has deliberately allowed it.
 */

const TIMEOUT_MS = 10 * 1000;

export type WebhookFields = {
    message: string;
    title: string;
    detail: string;
    event: string;
};

export const PLACEHOLDERS = [ "message", "title", "detail", "event" ] as const;

const hasPlaceholder = (url: string) => PLACEHOLDERS.some(name => url.includes(`{${ name }}`));

const fill = (url: string, fields: WebhookFields) => {
    let filled = url;

    for (const name of PLACEHOLDERS) {
        // into a URL, so it is encoded — a release name is full of dots, brackets and
        // ampersands, and an unencoded one would end the query string early
        filled = filled.replaceAll(`{${ name }}`, encodeURIComponent(fields[name]));
    }

    return filled;
};

/**
 * Names that resolve inside the machine or the network it sits on. Hostname based,
 * deliberately: catching a DNS name that resolves to a private address needs the
 * resolver and a check after every redirect, and that is more machinery than a home
 * install's threat model earns. This stops the obvious thing — pointing a webhook at
 * `127.0.0.1:8080` — and the setting exists for whoever really does have an internal
 * receiver.
 */
const PRIVATE = [
    /^localhost$/i,
    /\.local$/i,
    /\.internal$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^169\.254\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^\[?::1\]?$/,
    /^\[?f[cd]/i
];

export const webhookProblem = (url: string): string | null => {
    if (! url) {
        return null;
    }

    let parsed: URL;

    try {
        parsed = new URL(url);

    } catch {
        return "That is not a URL — it has to start with http:// or https://.";
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "Only http and https addresses can be called.";
    }

    if (! settingFlag("NOTIFY_WEBHOOK_ALLOW_PRIVATE") && PRIVATE.some(rule => rule.test(parsed.hostname))) {
        return "That address is inside the server's own network, which is not allowed. An administrator can turn that on under Settings / Notifications.";
    }

    return null;
};

/**
 * Sends it. Never throws — a webhook nobody maintains any more must not take a
 * download sync down with it — and returns what went wrong so the test button on the
 * account page can say it.
 */
export const callWebhook = async (url: string, fields: WebhookFields): Promise<{ ok: boolean, error?: string }> => {
    const problem = webhookProblem(url);

    if (problem) {
        return { ok: false, error: problem };
    }

    try {
        if (hasPlaceholder(url)) {
            await axios.get(fill(url, fields), { timeout: TIMEOUT_MS });

        } else {
            // `content` is Discord's field. Anything else with a plain JSON webhook
            // that wants a different key can put a placeholder in its URL instead.
            await axios.post(url, { content: fields.message }, { timeout: TIMEOUT_MS });
        }

        return { ok: true };

    } catch(err) {
        return { ok: false, error: errorText(err) };
    }
};
