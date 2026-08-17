import { User } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { LANGUAGE_DEFAULTS, parseLanguageList } from "@/lib/language";
import { logInfo } from "@/lib/log";
import { testWebhookUrl } from "@/lib/notify";
import { webhookProblem } from "@/lib/webhook";
import { cleanLanguageList } from "@/types/language";
import { NOTIFY_EVENT_VALUES } from "@/types/notify";

/**
 * The settings that belong to a person rather than to the install: the name they are
 * shown by, where their own notifications go, and which languages they want.
 *
 * They live here rather than in the route because there are two doors to them now —
 * your own page, and an administrator opening somebody else's from the users list. Two
 * doors to one set of rules is exactly the arrangement where the rules drift apart if
 * each door keeps its own copy.
 *
 * The password is deliberately not in here. Changing your own needs the old one, and
 * setting somebody else's is the users page's dialog; neither belongs to a settings
 * form that saves seven fields at once.
 */

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

/** The account as its settings page reads it, including the parts a session does not carry. */
export const accountOf = (user: User) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    hasPassword: !! user.passwordHash,
    linkedToProvider: !! user.oidcSubject,
    webhookUrl: user.webhookUrl || "",
    notifyEvents: user.notifyEvents || "",
    // the language rules are the person's now, and this is where they live — all
    // except what an untagged release counts as, which is the install's
    // (`QUALITY_UNTAGGED_LANGUAGE`) and is not sent here at all
    preferredLanguages: user.preferredLanguages || "",
    excludeLanguages: user.excludeLanguages || "",
    languageFirst: user.languageFirst ?? LANGUAGE_DEFAULTS.first,
    acceptAnyLanguage: user.acceptAnyLanguage ?? LANGUAGE_DEFAULTS.acceptAny
});

/**
 * Saves whatever of the account settings the body carries. Returns the reason it would
 * not take it, or null when it is saved — the caller turns that into a 400.
 *
 * The name is not handled here: it goes through `updateUser`, which is where the rules
 * about names already live.
 */
export const saveAccountSettings = async (id: number, body: unknown): Promise<string | null> => {
    const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

    // Which languages this person wants, in order. The first one is the only one the
    // scanner will fetch on its own, so an empty list is refused rather than silently
    // meaning "anything": that would be a person who never gets anything downloaded for
    // them, and nothing on screen would say why.
    //
    // Every one of them goes through the catalogue on the way in. The form only offers
    // what is in there, so this is for anything else that talks to the api — and it is
    // worth being strict about, because a code the release parser cannot produce is a
    // language nothing will ever be found in, with nothing on screen to say why. It is
    // also forgiving in the one direction that costs nothing: `hungarian`, `magyar` and
    // `hu` all arrive as `hun`.
    if (typeof input.preferredLanguages === "string") {
        const preferred = cleanLanguageList(input.preferredLanguages);
        const asked = parseLanguageList(input.preferredLanguages);

        if (! preferred) {
            return asked.length > 0
                ? `Not a language this app knows: ${ asked.join(", ") }. Pick from the list.`
                : "Name at least one language — the first one is what gets downloaded for you.";
        }

        // `defaultLanguage` is deliberately not read, not even to reject it: what an
        // untagged release counts as is the install's answer now
        // (`QUALITY_UNTAGGED_LANGUAGE`), and an old client still sending it should have
        // that half quietly ignored rather than its whole save refused
        await prisma.user.update({
            where: { id },
            data: {
                preferredLanguages: preferred,
                ...(typeof input.excludeLanguages === "string"
                    ? { excludeLanguages: cleanLanguageList(input.excludeLanguages) }
                    : {}),
                ...(typeof input.languageFirst === "boolean" ? { languageFirst: input.languageFirst } : {}),
                ...(typeof input.acceptAnyLanguage === "boolean" ? { acceptAnyLanguage: input.acceptAnyLanguage } : {})
            }
        });
    }

    // An empty url is a decision — it turns the notifications off.
    if (typeof input.webhookUrl === "string" || typeof input.notifyEvents === "string") {
        const url = typeof input.webhookUrl === "string" ? input.webhookUrl.trim() : null;

        // refused here rather than at the first download: a url the server will never
        // call is worth saying no to while somebody is looking at the form
        if (url) {
            const problem = webhookProblem(url);

            if (problem) {
                return problem;
            }
        }

        await prisma.user.update({
            where: { id },
            data: {
                ...(url !== null ? { webhookUrl: url || null } : {}),
                ...(typeof input.notifyEvents === "string" ? { notifyEvents: cleanEvents(input.notifyEvents) } : {})
            }
        });
    }

    return null;
};

/**
 * Calls this person's webhook once, now, and says what happened. The sending and the
 * wording are `testWebhookUrl`'s — the settings page tests the install's own the same way,
 * and one of the two asking it differently would be a difference nobody meant.
 *
 * `typed` is the field as it is on screen, so it can be tried before it is saved; empty
 * falls back to the stored one. `byAdmin` is the address of somebody testing on another
 * person's behalf, which the log says out loud: a test message arriving in a stranger's
 * chat should be traceable to whoever pressed the button.
 */
export const testWebhook = async (user: { id: number, name: string }, typed: string, byAdmin?: string) => {
    const stored = (await prisma.user.findUnique({ where: { id: user.id } }))?.webhookUrl || "";
    const url = typed.trim() || stored;

    if (! url) {
        return { ok: false, status: 400, message: "There is no webhook to test yet." };
    }

    const result = await testWebhookUrl(url);

    await logInfo(
        "notify",
        byAdmin ? `${ user.name }'s webhook was tested` : `${ user.name } tested their webhook`,
        byAdmin ? `${ result.said } — by ${ byAdmin }` : result.said
    );

    return { ok: result.ok, status: result.status, message: result.message };
};
