import { currentUser, refuseUnlessSignedIn } from "@/lib/auth";
import { testPush } from "@/lib/push";

/**
 * One notification, now, to every device this account has turned on. The same button the
 * webhook field has, and worth having for the same reason: the real ones only fire when a
 * download lands, and a permission that was granted to the wrong thing looks exactly like
 * one that was never going to be needed.
 *
 * It goes to all of them rather than to the browser that asked, because that is the
 * question being answered — "does my phone get these" is usually pressed from a laptop.
 */
export async function POST() {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const me = (await currentUser())!;
    const result = await testPush(me.id);

    return Response.json({ success: result.ok, message: result.message }, { status: result.ok ? 200 : 400 });
}
