import { currentUser, refuseUnlessAdmin, withActor } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import { testWebhookUrl } from "@/lib/notify";
import { loadSettings, settingText } from "@/lib/settings";

/**
 * The install's own webhook, called once, now — the same button the account page has, and
 * for the same reason: the real messages only fire when a download lands, so a typo in this
 * field is otherwise found out weeks later by not hearing about something.
 *
 * `url` is the field as it is on screen, so it can be tried before it is saved; empty falls
 * back to what is stored. The url is never echoed back or logged: it is the one setting in
 * this group whose value is a secret, because a Telegram one has the bot token in it.
 */
export async function POST(req: Request) {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    await loadSettings();

    const body = await req.json().catch(() => null);
    const typed = typeof body?.url === "string" ? body.url.trim() : "";
    const url = typed || settingText("NOTIFY_WEBHOOK_URL").trim();

    if (! url) {
        return Response.json({ success: false, message: "There is no webhook to test yet." }, { status: 400 });
    }

    const result = await testWebhookUrl(url);

    await logInfo("notify", "the install's webhook was tested", withActor(result.said, await currentUser()));

    return Response.json({ success: result.ok, message: result.message }, { status: result.status });
}
