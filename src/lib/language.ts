/**
 * Which languages a person wants, and what that means for what gets downloaded.
 *
 * These used to be five settings on the admin page, one set for the whole install.
 * They are a person's now, because a household does not agree about this: the same
 * film wanted in Hungarian and in English is two different files, and treating them
 * as one meant whoever configured the app decided for everybody else.
 *
 * One of the five went back to the admin page on 2026-08-16: what an **untagged** release
 * counts as. That one was never a preference — it is a claim about how release names work,
 * and a claim is either right or wrong for the whole install. See `untaggedLanguage`.
 *
 * The list is ordered and the **first entry is the primary**. That one is the only
 * language the scanner grabs on its own — everything below it is a fallback that a
 * person has to accept by hand, in front of the release list, knowing what they are
 * accepting. Nothing quietly settles for second best.
 */

import { prisma } from "@/lib/prisma";
import { settingText } from "@/lib/settings";

export type LanguageProfile = {
    /// ordered, first is the primary
    preferred: string[];
    exclude: string[];
    /**
     * What a release carrying no language tag at all is taken to be.
     *
     * The install's, not this person's — `QUALITY_UNTAGGED_LANGUAGE` on the admin page. It
     * sits in this type beside the personal fields because everything that judges a release
     * needs it in one place, but it is the same value for everybody: an untagged file either
     * is Hungarian or it is not, and two accounts cannot each be right about it. What *is*
     * personal is what follows from it — somebody whose first language is not this gets no
     * untagged release unattended.
     */
    untagged: string;
    /**
     * Language outranks resolution. **On by default**, because that is what wanting a
     * language means: a film you cannot understand is not a better copy of it. Off is
     * the deliberate choice — take the sharpest release and read subtitles.
     *
     * There is no weight next to this any more. It used to be a number ("language
     * bonus") and a number here can only be too small, in which case a preferred
     * language quietly loses to a few more seeders and nothing says why.
     */
    first: boolean;
    /**
     * Whether the list is a set of acceptable answers or only an order of preference.
     *
     * Off — the default — the first language is the only one fetched unattended, and
     * everything below it is a fallback somebody has to accept by hand at the dialog.
     * That is the safe direction, and it has one cost: a title that exists in no other
     * language than the second one on the list is never downloaded at all, and the
     * watchlist row says "waiting for release" forever.
     *
     * On, every language on the list is acceptable and the first one is still preferred,
     * because the scoring ranks by position in this very list.
     */
    acceptAny: boolean;
};

/**
 * What a new account starts with, and what a search falls back to when the account
 * behind it is gone. `untagged` here is only the floor under the setting — the value
 * that decides anything is `untaggedLanguage()`.
 */
export const LANGUAGE_DEFAULTS: LanguageProfile = {
    preferred: [ "hun", "eng" ],
    exclude: [],
    untagged: "eng",
    first: true,
    acceptAny: false
};

export const parseLanguageList = (value: string) => value
    .split(",")
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);

/**
 * What an untagged release is taken to be, install wide. Read on every call like every
 * other setting, so changing it on the admin page holds from the next search rather than
 * from the next restart — and read here rather than at each call site, because a fallback
 * copied around is a fallback that drifts.
 */
export const untaggedLanguage = () => {
    return settingText("QUALITY_UNTAGGED_LANGUAGE").trim().toLowerCase() || LANGUAGE_DEFAULTS.untagged;
};

/**
 * The columns as the app wants them, plus the one thing in this profile that is not the
 * person's — see `untagged`. Anything a person may edit is read from the row.
 */
export const toLanguageProfile = (user: {
    preferredLanguages: string;
    excludeLanguages: string;
    languageFirst: boolean;
    acceptAnyLanguage: boolean;
}): LanguageProfile => ({
    preferred: parseLanguageList(user.preferredLanguages),
    exclude: parseLanguageList(user.excludeLanguages),
    untagged: untaggedLanguage(),
    first: user.languageFirst,
    acceptAny: user.acceptAnyLanguage
});

/**
 * The one language this person is served by without being asked. An empty list is not
 * an error — it means "whatever a release is tagged as", and then the untagged default
 * is the honest answer, because that is what an unlabelled release will be treated as.
 */
export const primaryLanguage = (profile: LanguageProfile) => profile.preferred[0] || profile.untagged;

/**
 * Which languages a search may come back with, best first. This is the whole rule, in
 * one place, and there are exactly three cases:
 *
 * - the row named a language: that one and nothing else, because an answer to "what do
 *   you want" beats a rule about what is usually wanted;
 * - the account accepts any of its languages: all of them, in the order they are in —
 *   the scoring reads the same order, so the first is still what it reaches for;
 * - otherwise: the primary alone, which is the behaviour this app has always had.
 *
 * The array is never empty: an account with no languages at all falls back to whatever
 * an untagged release is taken to be, since that is what it would be judged as anyway.
 */
export const searchLanguages = (profile: LanguageProfile, requested?: string | null): string[] => {
    const own = (requested || "").trim().toLowerCase();

    if (own) {
        return [ own ];
    }

    const wanted = profile.acceptAny ? profile.preferred : [ primaryLanguage(profile) ];

    return wanted.length > 0 ? [ ...new Set(wanted) ] : [ profile.untagged ];
};

/**
 * Whose rules a search runs under. An account that has since been deleted falls back to
 * the defaults rather than throwing: the scanner is mid-round, and a missing row is not
 * a reason to stop looking for what is still on somebody's list.
 */
export const languageProfileOf = async (userId: number): Promise<LanguageProfile> => {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    // the untagged rule holds even with nobody behind the search: it is the install's
    // answer, and a deleted account cannot make an untagged release a different language
    return user ? toLanguageProfile(user) : { ...LANGUAGE_DEFAULTS, untagged: untaggedLanguage() };
};
