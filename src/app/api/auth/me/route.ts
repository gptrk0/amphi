import { prisma } from "@/lib/prisma";
import { accountOf, saveAccountSettings } from "@/lib/account";
import { currentUser, refuseUnlessSignedIn, signInWithPassword, startSession } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import { loadSettings } from "@/lib/settings";
import { updateUser, UserError } from "@/lib/users";

/** Your own account, including the parts the shared session state does not carry. */
export async function GET() {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const me = (await currentUser())!;
    const row = await prisma.user.findUnique({ where: { id: me.id } });

    if (! row) {
        return Response.json({ success: false, message: "No such user." }, { status: 404 });
    }

    return Response.json({ success: true, account: accountOf(row) });
}

/**
 * Your own account: the name you are shown by, the password, and where your own
 * notifications go. Changing the password needs the old one even though you are
 * already signed in — an unattended browser should not be enough to take an account
 * over.
 *
 * The change drops every session of this account, which is the point of it. This one
 * browser is then signed straight back in, so the person who just typed their own
 * password is not the one thrown out.
 *
 * Everything except the password is also reachable by an administrator, through
 * `/api/users/[id]/account` — same rules, same `saveAccountSettings`.
 */
export async function PATCH(req: Request) {
    try {
        await loadSettings();

        const refusal = await refuseUnlessSignedIn();

        if (refusal) {
            return refusal;
        }

        const me = (await currentUser())!;
        const body = await req.json().catch(() => null);

        const name = typeof body?.name === "string" ? body.name : undefined;
        const password = typeof body?.password === "string" && body.password ? body.password : undefined;
        const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";

        if (password) {
            if (! me.hasPassword) {
                // an account that only ever arrived through the provider has no old
                // password to prove; giving it one is an administrator's job
                return Response.json({
                    success: false,
                    message: "This account signs in through the provider and has no password to change."
                }, { status: 400 });
            }

            if (! await signInWithPassword(me.email, current)) {
                return Response.json({ success: false, message: "That is not your current password." }, { status: 403 });
            }
        }

        await updateUser(me.id, { name, password });

        const problem = await saveAccountSettings(me.id, body);

        if (problem) {
            return Response.json({ success: false, message: problem }, { status: 400 });
        }

        if (password) {
            await startSession(me.id);
            await logInfo("auth", `${ me.email } changed their password`, "every other signed in browser was signed out");

        } else if (name !== undefined) {
            await logInfo("auth", `${ me.email } changed their name`);
        }

        const fresh = await prisma.user.findUnique({ where: { id: me.id } });

        return Response.json({ success: true, name: fresh?.name || "" });

    } catch(err) {
        if (err instanceof UserError) {
            return Response.json({ success: false, message: err.message }, { status: 400 });
        }

        console.error(err);

        return Response.json({ success: false, message: "Could not save that." }, { status: 500 });
    }
}
