import { UserRole } from "../../../../prisma/generated/client";
import { currentUser, refuseUnlessAdmin } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import { loadSettings } from "@/lib/settings";
import { createUser, listUsers, toUserItem, UserError } from "@/lib/users";

const toRole = (value: unknown) => value === "ADMIN" ? UserRole.ADMIN : UserRole.USER;

export async function GET() {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    await loadSettings();

    return Response.json({ success: true, users: await listUsers() });
}

/**
 * An account added by hand. The password is optional: for an install that signs in
 * through a provider this is how somebody is let in before they have ever been here,
 * and the first sign-in adopts the row by address.
 */
export async function POST(req: Request) {
    try {
        const refusal = await refuseUnlessAdmin();

        if (refusal) {
            return refusal;
        }

        const me = await currentUser();
        const body = await req.json().catch(() => null);

        const user = await createUser({
            email: typeof body?.email === "string" ? body.email : "",
            name: typeof body?.name === "string" ? body.name : "",
            password: typeof body?.password === "string" && body.password ? body.password : undefined,
            role: toRole(body?.role)
        });

        await logInfo(
            "auth",
            `${ user.email } was added as ${ user.role === UserRole.ADMIN ? "an administrator" : "a user" }`,
            `by ${ me?.email }${ user.passwordHash ? "" : ", with no password — they can only arrive through the provider" }`
        );

        return Response.json({ success: true, user: toUserItem(user), users: await listUsers() });

    } catch(err) {
        if (err instanceof UserError) {
            return Response.json({ success: false, message: err.message }, { status: 400 });
        }

        console.error(err);

        return Response.json({ success: false, message: "Could not create the account." }, { status: 500 });
    }
}
