/**
 * Which languages a person wants, and what that means for what gets downloaded.
 *
 * These used to be five settings on the admin page, one set for the whole install.
 * They are a person's now, because a household does not agree about this: the same
 * film wanted in Hungarian and in English is two different files, and treating them
 * as one meant whoever configured the app decided for everybody else.
 *
 * The list is ordered and the **first entry is the primary**. That one is the only
 * language the scanner grabs on its own — everything below it is a fallback that a
 * person has to accept by hand, in front of the release list, knowing what they are
 * accepting. Nothing quietly settles for second best.
 */

import { prisma } from "@/lib/prisma";

export type LanguageProfile = {
    /// ordered, first is the primary
    preferred: string[];
    exclude: string[];
    /// what a release carrying no language tag at all is taken to be
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
};

/**
 * What a new account starts with, and what a search falls back to when the account
 * behind it is gone.
 */
export const LANGUAGE_DEFAULTS: LanguageProfile = {
    preferred: [ "hun", "eng" ],
    exclude: [],
    untagged: "eng",
    first: true
};

export const parseLanguageList = (value: string) => value
    .split(",")
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);

/** The columns as the app wants them. Anything a person may edit is read from here. */
export const toLanguageProfile = (user: {
    preferredLanguages: string;
    excludeLanguages: string;
    defaultLanguage: string;
    languageFirst: boolean;
}): LanguageProfile => ({
    preferred: parseLanguageList(user.preferredLanguages),
    exclude: parseLanguageList(user.excludeLanguages),
    untagged: user.defaultLanguage.trim().toLowerCase() || LANGUAGE_DEFAULTS.untagged,
    first: user.languageFirst
});

/**
 * The one language this person is served by without being asked. An empty list is not
 * an error — it means "whatever a release is tagged as", and then the untagged default
 * is the honest answer, because that is what an unlabelled release will be treated as.
 */
export const primaryLanguage = (profile: LanguageProfile) => profile.preferred[0] || profile.untagged;

/**
 * Whose rules a search runs under. An account that has since been deleted falls back to
 * the defaults rather than throwing: the scanner is mid-round, and a missing row is not
 * a reason to stop looking for what is still on somebody's list.
 */
export const languageProfileOf = async (userId: number): Promise<LanguageProfile> => {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    return user ? toLanguageProfile(user) : LANGUAGE_DEFAULTS;
};
