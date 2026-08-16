import { prisma } from "@/lib/prisma";
import { accountOf, saveAccountSettings } from "@/lib/account";
import { currentUser, refuseUnlessAdmin } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import { loadSettings } from "@/lib/settings";
import { updateUser, UserError } from "@/lib/users";

type Params = { params: Promise<{ id: string }> };

/**
 * Somebody else's account settings, for an administrator.
 *
 * These were once nobody's business but their own. What changed the answer is the
 * install this app is for: one household, one administrator, and people who would
 * rather be asked what language they want than be handed a settings page. Somebody has
 * to be able to set it up for them — and the alternative to doing it here was doing it
 * in the database, which is not an alternative.
 *
 * It is the same form and the same rules as `/api/auth/me`, with two things left out.
 * The password is not here: setting one for somebody is the users page's own dialog,
 * which signs their browsers out, and that does not belong in a form that saves seven
 * fields at once. And every save says in the log whose account it was and who changed
 * it — a webhook that starts pointing somewhere else should never be a mystery.
 */
export async function GET(_req: Request, { params }: Params) {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    const { id } = await params;
    const userId = Number(id);

    if (! userId) {
        return Response.json({ success: false, message: "Invalid id!" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (! user) {
        return Response.json({ success: false, message: "No such user." }, { status: 404 });
    }

    return Response.json({ success: true, account: accountOf(user) });
}

export async function PATCH(req: Request, { params }: Params) {
    try {
        await loadSettings();

        const refusal = await refuseUnlessAdmin();

        if (refusal) {
            return refusal;
        }

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
        const name = typeof body?.name === "string" ? body.name : undefined;

        await updateUser(userId, { name });

        const problem = await saveAccountSettings(userId, body);

        if (problem) {
            return Response.json({ success: false, message: problem }, { status: 400 });
        }

        const fresh = (await prisma.user.findUnique({ where: { id: userId } }))!;

        await logInfo(
            "auth",
            userId === me.id ? `${ me.email } changed their account settings` : `${ user.email }'s account settings were changed`,
            userId === me.id ? undefined : `by ${ me.email }`
        );

        return Response.json({ success: true, account: accountOf(fresh) });

    } catch(err) {
        if (err instanceof UserError) {
            return Response.json({ success: false, message: err.message }, { status: 400 });
        }

        console.error(err);

        return Response.json({ success: false, message: "Could not save that." }, { status: 500 });
    }
}
