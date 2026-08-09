import { currentUser, endSession } from "@/lib/auth";
import { logInfo } from "@/lib/log";

/** POST and not GET, so a link on some other page cannot sign somebody out. */
export async function POST() {
    const user = await currentUser();

    await endSession();

    if (user) {
        await logInfo("auth", `${ user.email } signed out`);
    }

    return Response.json({ success: true });
}
