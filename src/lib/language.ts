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
    bonus: number;
    /// language outranks resolution
    first: boolean;
};

/**
 * What a new account starts with, and what the migration falls back to. The same
 * values the install-wide settings had, so nobody's downloads change shape on the
 * day the setting moved.
 */
export const LANGUAGE_DEFAULTS: LanguageProfile = {
    preferred: [ "hun", "eng" ],
    exclude: [],
    untagged: "eng",
    bonus: 1000000,
    first: false
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
    languageBonus: number;
    languageFirst: boolean;
}): LanguageProfile => ({
    preferred: parseLanguageList(user.preferredLanguages),
    exclude: parseLanguageList(user.excludeLanguages),
    untagged: user.defaultLanguage.trim().toLowerCase() || LANGUAGE_DEFAULTS.untagged,
    bonus: user.languageBonus,
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
