import { prisma } from "@/lib/prisma";
import { testWebhook } from "@/lib/account";
import { currentUser, refuseUnlessAdmin } from "@/lib/auth";
import { loadSettings } from "@/lib/settings";

type Params = { params: Promise<{ id: string }> };

/**
 * Somebody else's webhook, called once, now. Same button as on your own page — an
 * administrator setting a webhook up for somebody should find out about the typo while
 * the form is still open, not when their first download lands.
 *
 * The message goes to a stranger's Telegram, so the log line says who sent it.
 */
export async function POST(req: Request, { params }: Params) {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    await loadSettings();

    const { id } = await params;
    const userId = Number(id);
    const me = (await currentUser())!;

    if (! userId) {
        return Response.json({ success: false, message: "Invalid id!" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (! user) {
        return Response.json({ success: false, message: "No such user." }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const typed = typeof body?.webhookUrl === "string" ? body.webhookUrl : "";

    const result = await testWebhook(user, typed, userId === me.id ? undefined : me.email);

    return Response.json({ success: result.ok, message: result.message }, { status: result.status });
}
