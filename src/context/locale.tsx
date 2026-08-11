'use client';

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
    DEFAULT_LOCALE,
    Locale,
    LOCALE_COOKIE,
    looseTranslator,
    MessageKey,
    TranslateOr,
    translator,
    Vars
} from "@/i18n";

/**
 * Which language the interface is in, for everything under the shell.
 *
 * The initial value comes from the server, which read the cookie — so the first paint is
 * already right and there is nothing to correct after hydration. Changing it writes the
 * cookie and swaps the dictionary in place: no reload, because every page here draws from
 * state that is already in the browser, and a reload would throw away the scroll position
 * and every listing the browse cache is holding.
 *
 * **The words are not the whole page, though.** Titles, plot summaries, genre names and
 * episode names come from TMDB in the reader's language, and those are already fetched and
 * sitting in component state — swapping the dictionary alone would leave a Hungarian page
 * full of English cards. So the change also invalidates what was fetched:
 *
 * - `router.refresh()` re-renders whatever the server drew, which is the details page.
 * - the listings key their fetches and their browse cache entries on the language, so a
 *   switch is a fresh listing and a switch back is the remembered one.
 * - the two tables refetch, because their rows carry TMDB names too.
 */

type LocaleContextValue = {
    locale: Locale;
    setLocale: (next: Locale) => void;
    t: (key: MessageKey, vars?: Vars) => string;
    // for keys built at run time, with the English the server sent as the fallback
    tOr: TranslateOr;
};

const fallback: LocaleContextValue = {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: translator(DEFAULT_LOCALE),
    tOr: looseTranslator(DEFAULT_LOCALE)
};

export const LocaleContext = createContext<LocaleContextValue>(fallback);

/** Everything user-facing goes through this. `t` is stable for one language. */
export const useLocale = () => useContext(LocaleContext);

// a year, and readable by the server on the next request — that is the whole point of it
const remember = (locale: Locale) => {
    document.cookie = `${ LOCALE_COOKIE }=${ locale }; path=/; max-age=${ 365 * 24 * 60 * 60 }; samesite=lax`;
};

export function LocaleProvider({ initial, children }: { initial: Locale, children: React.ReactNode }) {
    const [ locale, setLocaleState ] = useState<Locale>(initial);
    const router = useRouter();

    const setLocale = useCallback((next: Locale) => {
        remember(next);
        setLocaleState(next);

        // the language is also on the document, for a screen reader and for the browser's
        // own spellchecking — the server sets it, and this keeps it honest afterwards
        document.documentElement.lang = next;

        // the cookie is written by now, so anything the server draws is drawn again in the
        // new language: the details page, and the shell's own `<html lang>`
        router.refresh();
    }, [ router ]);

    const value = useMemo(() => ({
        locale,
        setLocale,
        t: translator(locale),
        tOr: looseTranslator(locale)
    }), [ locale, setLocale ]);

    return <LocaleContext.Provider value={value}>{ children }</LocaleContext.Provider>;
}
