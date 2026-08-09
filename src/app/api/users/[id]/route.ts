import { UserRole } from "../../../../../prisma/generated/client";
import { currentUser, refuseUnlessAdmin } from "@/lib/auth";
import { logInfo, logWarn } from "@/lib/log";
import { deleteUser, listUsers, updateUser, UserError } from "@/lib/users";

type Params = { params: Promise<{ id: string }> };

/**
 * Role, name, whether the account is switched off, and setting a password for
 * somebody. What is deliberately missing is a way to read a password back — there is
 * nothing stored that could be read back, only replaced.
 *
 * An administrator cannot demote or switch off themselves. Not a safety rule so much
 * as a sanity one: the button that takes your own settings page away mid-click is
 * never what anyone meant to press.
 */
export async function PATCH(req: Request, { params }: Params) {
    try {
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

        const body = await req.json().catch(() => null);
        const changes: Parameters<typeof updateUser>[1] = {};

        if (typeof body?.name === "string") {
            changes.name = body.name;
        }

        if (body?.role === "ADMIN" || body?.role === "USER") {
            if (userId === me.id) {
                return Response.json({ success: false, message: "You cannot change your own role." }, { status: 400 });
            }

            changes.role = body.role === "ADMIN" ? UserRole.ADMIN : UserRole.USER;
        }

        if (typeof body?.disabled === "boolean") {
            if (userId === me.id) {
                return Response.json({ success: false, message: "You cannot switch your own account off." }, { status: 400 });
            }

            changes.disabled = body.disabled;
        }

        if (typeof body?.password === "string") {
            changes.password = body.password || null;
        }

        const user = await updateUser(userId, changes);
        const said: string[] = [];

        if (changes.role !== undefined) {
            said.push(`role → ${ changes.role.toLowerCase() }`);
        }

        if (changes.disabled !== undefined) {
            said.push(changes.disabled ? "switched off" : "switched back on");
        }

        if (changes.password !== undefined) {
            said.push(changes.password ? "password replaced" : "password removed");
        }

        if (said.length > 0) {
            await logInfo("auth", `${ user.email } was changed`, `${ said.join(", ") } — by ${ me.email }`);
        }

        return Response.json({ success: true, users: await listUsers() });

    } catch(err) {
        if (err instanceof UserError) {
            return Response.json({ success: false, message: err.message }, { status: 400 });
        }

        console.error(err);

        return Response.json({ success: false, message: "Could not save that." }, { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: Params) {
    try {
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

        if (userId === me.id) {
            return Response.json({ success: false, message: "You cannot delete your own account." }, { status: 400 });
        }

        const user = await deleteUser(userId);

        await logWarn("auth", `${ user.email } was deleted`, `by ${ me.email }`);

        return Response.json({ success: true, users: await listUsers() });

    } catch(err) {
        if (err instanceof UserError) {
            return Response.json({ success: false, message: err.message }, { status: 400 });
        }

        console.error(err);

        return Response.json({ success: false, message: "Could not delete the account." }, { status: 500 });
    }
}
