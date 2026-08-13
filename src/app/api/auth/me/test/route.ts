import { prisma } from "@/lib/prisma";
import { currentUser, refuseUnlessSignedIn } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import { loadSettings } from "@/lib/settings";
import { webhookFields } from "@/lib/notify";
import { callWebhook } from "@/lib/webhook";

/**
 * Calls the webhook once, now, and says what happened.
 *
 * Worth its own endpoint because the alternative is finding out weeks later that the
 * URL had a typo — the real ones only fire when a download lands, and a webhook that
 * silently fails looks exactly like one that was never going to be needed.
 *
 * The URL can be passed in so the field can be tested before it is saved.
 */
export async function POST(req: Request) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    await loadSettings();

    const me = (await currentUser())!;
    const body = await req.json().catch(() => null);

    const typed = typeof body?.webhookUrl === "string" ? body.webhookUrl.trim() : "";
    const stored = (await prisma.user.findUnique({ where: { id: me.id } }))?.webhookUrl || "";
    const url = typed || stored;

    if (! url) {
        return Response.json({ success: false, message: "There is no webhook to test yet." }, { status: 400 });
    }

    const result = await callWebhook(url, webhookFields("ready", "A test from Amphi", "if you can read this, it works"));

    await logInfo(
        "notify",
        `${ me.name } tested their webhook`,
        result.ok ? "it went through" : `it failed: ${ result.error }`
    );

    return Response.json({
        success: result.ok,
        message: result.ok
            ? "Sent — go and look."
            : `It did not go through: ${ result.error }`
    }, { status: result.ok ? 200 : 502 });
}
