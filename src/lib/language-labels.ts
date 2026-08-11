'use client';

import { useMemo } from "react";

import { useLocale } from "@/context/locale";
import { MessageKey, TranslateOr } from "@/i18n";
import { LANGUAGES, languageName } from "@/types/language";

/**
 * The language catalogue, read in the language of the page.
 *
 * The *codes* are the data and never change — `hun` is what is stored, compared and
 * matched against a release name. Only the names people read are translated, and the
 * English name stays in the dropdown's keywords: somebody who knows the app in English,
 * or who has a Hungarian page and an English keyboard habit, still finds "hungarian".
 */
export const languageLabel = (code: string, tOr: TranslateOr) => {
    return tOr(`language.${ code }`, languageName(code));
};

export const useLanguageOptions = () => {
    const { t } = useLocale();

    return useMemo(() => LANGUAGES.map(entry => ({
        value: entry.code,
        label: t(`language.${ entry.code }` as MessageKey),
        keywords: [ ...entry.aliases, entry.iso1, entry.name.toLowerCase() ]
    })), [ t ]);
};
