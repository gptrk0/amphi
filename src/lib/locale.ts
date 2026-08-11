import { cookies } from "next/headers";

import { DEFAULT_LOCALE, Locale, LOCALE_COOKIE, localeFrom } from "@/i18n";

/**
 * Which language the person asking for this reads in, on the server.
 *
 * The same cookie the shell is rendered from, so the metadata a page shows and the words
 * around it are in one language rather than two.
 *
 * **Outside a request there is nobody asking** — the scan round, the download sync,
 * anything started from `instrumentation.ts` — and `cookies()` throws there rather than
 * returning nothing. That is not an error here: it is the answer. The default locale is
 * what the app writes in when it is writing for itself.
 */
export const readerLocale = async (): Promise<Locale> => {
    try {
        return localeFrom((await cookies()).get(LOCALE_COOKIE)?.value);

    } catch {
        return DEFAULT_LOCALE;
    }
};
