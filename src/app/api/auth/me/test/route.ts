import { testWebhook } from "@/lib/account";
import { currentUser, refuseUnlessSignedIn } from "@/lib/auth";
import { loadSettings } from "@/lib/settings";

/**
 * Calls your own webhook once, now, and says what happened. The URL can be passed in so
 * the field can be tested before it is saved.
 *
 * The same thing for somebody else's account is `/api/users/[id]/account/test`, which is
 * for administrators and says in the log who pressed it.
 */
export async function POST(req: Request) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    await loadSettings();

    const me = (await currentUser())!;
    const body = await req.json().catch(() => null);
    const typed = typeof body?.webhookUrl === "string" ? body.webhookUrl : "";

    const result = await testWebhook(me, typed);

    return Response.json({ success: result.ok, message: result.message }, { status: result.status });
}
