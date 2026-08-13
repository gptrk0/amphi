import { en } from "@/i18n/en";
import { hu } from "@/i18n/hu";

/**
 * The interface in two languages, by hand.
 *
 * **Why no library.** next-intl and friends want to own the routing — a `/hu/...` prefix,
 * a middleware that rewrites, a `[locale]` segment above every page. This app has one
 * client-rendered shell and twelve pages under it, and a language is a preference of the
 * person rather than a property of the address: two people on one install read it in two
 * languages, and neither wants their bookmarks to change. So the choice lives in a cookie
 * and the dictionary is an object.
 *
 * **The cookie and not localStorage**, because the server renders the shell: with the
 * value in a cookie the first paint is already in the right language, and `<html lang>` is
 * right for a screen reader on that same first paint. localStorage is only readable after
 * the javascript arrives, which is one flash of English on every load.
 *
 * **English is the source.** `en` is the shape every other language is checked against, so
 * a key that exists in one and not the other does not compile. That is what makes "usable
 * in Hungarian" a mechanical fact rather than a hope.
 *
 * **What is deliberately not translated.** The log and the notifications: those are
 * records of something that happened, written when it happened, and a line that would
 * change language depending on who is reading it is not a record. Release names, indexer
 * ids and language codes are likewise what they are.
 */

export const LOCALES = [ "en", "hu" ] as const;

export type Locale = typeof LOCALES[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "amphi_locale";

// in its own language, always — somebody looking for Hungarian is looking for "Magyar"
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", hu: "Magyar" };

export type Messages = typeof en;

const DICTIONARIES: Record<Locale, Messages> = { en, hu };

export const isLocale = (value: unknown): value is Locale => {
    return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
};

export const localeFrom = (value: unknown): Locale => isLocale(value) ? value : DEFAULT_LOCALE;

/**
 * Every key in the dictionary, as a dotted path. Worth the type gymnastics: a mistyped key
 * is otherwise a string that quietly renders as itself, in the one part of the app whose
 * whole job is what the words say.
 */
export type MessageKey<T = Messages> = {
    [K in keyof T & string]: T[K] extends string ? K : `${ K }.${ MessageKey<T[K]> }`
}[keyof T & string];

export type Vars = Record<string, string | number>;

const lookup = (dictionary: Messages, key: string): string | undefined => {
    let node: unknown = dictionary;

    for (const part of key.split(".")) {
        if (typeof node !== "object" || node === null) {
            return undefined;
        }

        node = (node as Record<string, unknown>)[part];
    }

    return typeof node === "string" ? node : undefined;
};

/**
 * `{name}` in a message is filled in from `vars`. Nothing cleverer: no plural rules
 * engine, because Hungarian does not need one for counts (`3 epizód`, not `3 epizódok`)
 * and English needs one rule, which the messages spell out themselves where it matters.
 */
const fill = (text: string, vars?: Vars) => {
    if (! vars) {
        return text;
    }

    return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
        const value = vars[name];

        return value === undefined ? whole : String(value);
    });
};

export type Translate = (key: MessageKey, vars?: Vars) => string;

/**
 * The translator for one language. A key the chosen language does not have falls back to
 * English rather than to the key itself: a half-translated install should read as English
 * in that spot, not as `watchlist.table.empty`.
 */
export const translator = (locale: Locale): Translate => {
    const dictionary = DICTIONARIES[locale] || DICTIONARIES[DEFAULT_LOCALE];

    return (key, vars) => fill(lookup(dictionary, key) ?? lookup(DICTIONARIES[DEFAULT_LOCALE], key) ?? key, vars);
};

export type TranslateOr = (key: string, fallback: string, vars?: Vars) => string;

/**
 * For a key that is built at run time — a discover row's heading, a setting's label — where
 * the type cannot know it exists. The caller hands in what to say when it does not, which
 * is always the English the server already sent: a row the api learned about after this
 * dictionary was written shows up in English rather than as `discover.sections.x.title`.
 */
export const looseTranslator = (locale: Locale): TranslateOr => {
    const dictionary = DICTIONARIES[locale] || DICTIONARIES[DEFAULT_LOCALE];

    return (key, fallback, vars) => fill(lookup(dictionary, key) ?? lookup(DICTIONARIES[DEFAULT_LOCALE], key) ?? fallback, vars);
};
