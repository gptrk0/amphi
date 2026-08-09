import { needsSetup, startSession } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import { loadSettings } from "@/lib/settings";
import { createFirstAdmin, UserError } from "@/lib/users";

/**
 * The first administrator, created by whoever reaches a fresh install first. It is
 * checked twice — here and inside `createFirstAdmin` — because this is the only
 * endpoint in the app that answers a stranger with a write.
 */
export async function POST(req: Request) {
    try {
        await loadSettings();

        if (! await needsSetup()) {
            return Response.json({ success: false, message: "This install already has an administrator." }, { status: 409 });
        }

        const body = await req.json().catch(() => null);

        const user = await createFirstAdmin({
            email: typeof body?.email === "string" ? body.email : "",
            name: typeof body?.name === "string" ? body.name : "",
            password: typeof body?.password === "string" ? body.password : ""
        });

        await startSession(user.id);
        await logInfo("auth", `the install was claimed by ${ user.email }`, "first administrator, created on the setup page");

        return Response.json({ success: true });

    } catch(err) {
        if (err instanceof UserError) {
            return Response.json({ success: false, message: err.message }, { status: 400 });
        }

        console.error(err);

        return Response.json({ success: false, message: "Could not create the account." }, { status: 500 });
    }
}
