import { prisma } from "@/lib/prisma";
import { currentUser, refuseUnlessSignedIn, signInWithPassword, startSession } from "@/lib/auth";
import { LANGUAGE_DEFAULTS, parseLanguageList } from "@/lib/language";
import { logInfo } from "@/lib/log";
import { loadSettings } from "@/lib/settings";
import { updateUser, UserError } from "@/lib/users";
import { webhookProblem } from "@/lib/webhook";
import { cleanLanguageList, resolveLanguage } from "@/types/language";
import { NOTIFY_EVENT_VALUES } from "@/types/notify";

/**
 * Only events that exist. The form ticks boxes, so nothing it sends can be wrong — but a
 * value this does not recognise would quietly mean "send me nothing", which is the one
 * outcome nobody would go looking for a typo to explain.
 */
const cleanEvents = (value: string) => value
    .split(",")
    .map(event => event.trim().toLowerCase())
    .filter(event => event === "*" || NOTIFY_EVENT_VALUES.includes(event))
    .join(",");

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
            languageFirst: row?.languageFirst ?? LANGUAGE_DEFAULTS.first,
            acceptAnyLanguage: row?.acceptAnyLanguage ?? LANGUAGE_DEFAULTS.acceptAny
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
        //
        // Every one of them goes through the catalogue on the way in. The form only offers
        // what is in there, so this is for anything else that talks to the api — and it is
        // worth being strict about, because a code the release parser cannot produce is a
        // language nothing will ever be found in, with nothing on screen to say why. It is
        // also forgiving in the one direction that costs nothing: `hungarian`, `magyar` and
        // `hu` all arrive as `hun`.
        if (typeof body?.preferredLanguages === "string") {
            const preferred = cleanLanguageList(body.preferredLanguages);
            const asked = parseLanguageList(body.preferredLanguages);

            if (! preferred) {
                return Response.json({
                    success: false,
                    message: asked.length > 0
                        ? `Not a language this app knows: ${ asked.join(", ") }. Pick from the list.`
                        : "Name at least one language — the first one is what gets downloaded for you."
                }, { status: 400 });
            }

            const untagged = typeof body.defaultLanguage === "string" ? resolveLanguage(body.defaultLanguage) : null;

            // this one cannot be dropped and cannot be empty: it is what every untagged
            // release is taken to be, so a wrong value here quietly re-labels everything
            if (typeof body.defaultLanguage === "string" && body.defaultLanguage.trim() && ! untagged) {
                return Response.json({
                    success: false,
                    message: `"${ body.defaultLanguage.trim() }" is not a language this app knows.`
                }, { status: 400 });
            }

            await prisma.user.update({
                where: { id: me.id },
                data: {
                    preferredLanguages: preferred,
                    ...(typeof body.excludeLanguages === "string"
                        ? { excludeLanguages: cleanLanguageList(body.excludeLanguages) }
                        : {}),
                    ...(untagged ? { defaultLanguage: untagged } : {}),
                    ...(typeof body.languageFirst === "boolean" ? { languageFirst: body.languageFirst } : {}),
                    ...(typeof body.acceptAnyLanguage === "boolean" ? { acceptAnyLanguage: body.acceptAnyLanguage } : {})
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
                    ...(typeof body.notifyEvents === "string" ? { notifyEvents: cleanEvents(body.notifyEvents) } : {})
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
