import { prisma } from "@/lib/prisma";
import { currentUser, refuseUnlessSignedIn, signInWithPassword, startSession } from "@/lib/auth";
import { LANGUAGE_DEFAULTS, parseLanguageList } from "@/lib/language";
import { logInfo } from "@/lib/log";
import { loadSettings } from "@/lib/settings";
import { updateUser, UserError } from "@/lib/users";
import { webhookProblem } from "@/lib/webhook";

/** Your own account, including the parts the shared session state does not carry. */
export async function GET() {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const me = (await currentUser())!;
    const row = await prisma.user.findUnique({ where: { id: me.id } });

    return Response.json({
        success: true,
        account: {
            id: me.id,
            email: me.email,
            name: me.name,
            role: me.role,
            hasPassword: me.hasPassword,
            linkedToProvider: me.linkedToProvider,
            webhookUrl: row?.webhookUrl || "",
            notifyEvents: row?.notifyEvents || "",
            // the language rules are the person's now, and this is where they live
            preferredLanguages: row?.preferredLanguages || "",
            excludeLanguages: row?.excludeLanguages || "",
            defaultLanguage: row?.defaultLanguage || LANGUAGE_DEFAULTS.untagged,
            languageBonus: row?.languageBonus ?? LANGUAGE_DEFAULTS.bonus,
            languageFirst: row?.languageFirst ?? LANGUAGE_DEFAULTS.first
        }
    });
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

        // Which languages this person wants, in order. The first one is the only one
        // the scanner will fetch on its own, so an empty list is refused rather than
        // silently meaning "anything": that would be a person who never gets anything
        // downloaded for them, and nothing on screen would say why.
        if (typeof body?.preferredLanguages === "string") {
            const preferred = parseLanguageList(body.preferredLanguages);

            if (preferred.length === 0) {
                return Response.json({
                    success: false,
                    message: "Name at least one language — the first one is what gets downloaded for you."
                }, { status: 400 });
            }

            const bonus = Number(body.languageBonus);

            await prisma.user.update({
                where: { id: me.id },
                data: {
                    preferredLanguages: preferred.join(","),
                    ...(typeof body.excludeLanguages === "string"
                        ? { excludeLanguages: parseLanguageList(body.excludeLanguages).join(",") }
                        : {}),
                    ...(typeof body.defaultLanguage === "string" && body.defaultLanguage.trim()
                        ? { defaultLanguage: body.defaultLanguage.trim().toLowerCase() }
                        : {}),
                    ...(Number.isFinite(bonus) && bonus >= 0 ? { languageBonus: Math.round(bonus) } : {}),
                    ...(typeof body.languageFirst === "boolean" ? { languageFirst: body.languageFirst } : {})
                }
            });
        }

        // Not through `updateUser`: these are nobody's business but their own, so an
        // administrator has no way to set them and this is the only place they change.
        // An empty url is a decision — it turns the notifications off.
        if (typeof body?.webhookUrl === "string" || typeof body?.notifyEvents === "string") {
            const url = typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : null;

            // refused here rather than at the first download: a url the server will
            // never call is worth saying no to while somebody is looking at the form
            if (url) {
                const problem = webhookProblem(url);

                if (problem) {
                    return Response.json({ success: false, message: problem }, { status: 400 });
                }
            }

            await prisma.user.update({
                where: { id: me.id },
                data: {
                    ...(url !== null ? { webhookUrl: url || null } : {}),
                    ...(typeof body.notifyEvents === "string" ? { notifyEvents: body.notifyEvents.trim() } : {})
                }
            });
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
