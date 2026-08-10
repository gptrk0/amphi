/**
 * Every language this app can recognise, in one place.
 *
 * **Why the list is exactly this long.** These are the languages a release name can be
 * *parsed* into — `aliases` is what the parser looks for in the tag section of a title.
 * Offering a language that is not here would be offering one no release could ever match:
 * the title would sit on a watchlist for good, and nothing would ever say why. So the
 * dropdown, the release parser and the original-language mapping all read this array, and
 * adding a language means adding the names releases actually carry for it.
 *
 * `code` is what is stored, everywhere — the three letter form on purpose, because two
 * letter codes cannot be looked for in a release name ("Dan in Real Life" is not Danish).
 * `iso1` is only there for the other direction: TMDB reports a title's original language
 * as two letters.
 */

export type LanguageEntry = {
    /// what is stored and what the scoring compares
    code: string;
    /// what a person reads
    name: string;
    /// TMDB's form of it
    iso1: string;
    /// what a release name may call it, beyond the code itself
    aliases: string[];
};

export const LANGUAGES: LanguageEntry[] = [
    { code: "hun", name: "Hungarian", iso1: "hu", aliases: [ "hungarian", "magyar" ] },
    { code: "eng", name: "English", iso1: "en", aliases: [ "english" ] },
    { code: "ita", name: "Italian", iso1: "it", aliases: [ "italian", "italiano" ] },
    { code: "ger", name: "German", iso1: "de", aliases: [ "deu", "german", "deutsch" ] },
    { code: "fre", name: "French", iso1: "fr", aliases: [ "fra", "french", "francais", "truefrench", "vff", "vfq", "vostfr" ] },
    { code: "spa", name: "Spanish", iso1: "es", aliases: [ "spanish", "espanol", "castellano", "latino" ] },
    { code: "por", name: "Portuguese", iso1: "pt", aliases: [ "portuguese", "dublado" ] },
    { code: "rus", name: "Russian", iso1: "ru", aliases: [ "russian" ] },
    { code: "pol", name: "Polish", iso1: "pl", aliases: [ "polish", "lektor" ] },
    { code: "cze", name: "Czech", iso1: "cs", aliases: [ "ces", "czech" ] },
    { code: "slo", name: "Slovak", iso1: "sk", aliases: [ "slovak" ] },
    { code: "tur", name: "Turkish", iso1: "tr", aliases: [ "turkish" ] },
    { code: "ara", name: "Arabic", iso1: "ar", aliases: [ "arabic" ] },
    { code: "hin", name: "Hindi", iso1: "hi", aliases: [ "hindi" ] },
    { code: "tam", name: "Tamil", iso1: "ta", aliases: [ "tamil" ] },
    { code: "tel", name: "Telugu", iso1: "te", aliases: [ "telugu" ] },
    { code: "kor", name: "Korean", iso1: "ko", aliases: [ "korean" ] },
    { code: "jpn", name: "Japanese", iso1: "ja", aliases: [ "jap", "japanese" ] },
    { code: "chi", name: "Chinese", iso1: "zh", aliases: [ "chinese", "mandarin", "cantonese" ] },
    { code: "tha", name: "Thai", iso1: "th", aliases: [ "thai" ] },
    { code: "vie", name: "Vietnamese", iso1: "vi", aliases: [ "vietnamese" ] },
    { code: "ukr", name: "Ukrainian", iso1: "uk", aliases: [ "ukrainian" ] },
    { code: "rum", name: "Romanian", iso1: "ro", aliases: [ "ron", "romanian" ] },
    { code: "bul", name: "Bulgarian", iso1: "bg", aliases: [ "bulgarian" ] },
    { code: "dut", name: "Dutch", iso1: "nl", aliases: [ "nld", "dutch" ] },
    { code: "swe", name: "Swedish", iso1: "sv", aliases: [ "swedish" ] },
    { code: "nor", name: "Norwegian", iso1: "no", aliases: [ "norwegian" ] },
    { code: "dan", name: "Danish", iso1: "da", aliases: [ "danish" ] },
    { code: "fin", name: "Finnish", iso1: "fi", aliases: [ "finnish" ] },
    { code: "gre", name: "Greek", iso1: "el", aliases: [ "greek" ] },
    { code: "heb", name: "Hebrew", iso1: "he", aliases: [ "hebrew" ] },
    { code: "per", name: "Persian", iso1: "fa", aliases: [ "farsi", "persian" ] },
    { code: "ind", name: "Indonesian", iso1: "id", aliases: [ "indonesian" ] }
];

/** For the dropdown, and for anything else that offers the whole set. */
export const LANGUAGE_OPTIONS = LANGUAGES.map(entry => ({
    value: entry.code,
    label: entry.name,
    // typing "magyar", "hungarian" or "hu" finds it too — nobody should have to know
    // which of the three forms this app happens to store
    keywords: [ ...entry.aliases, entry.iso1 ]
}));

const byAnyName = new Map<string, string>();

for (const entry of LANGUAGES) {
    for (const name of [ entry.code, entry.name, entry.iso1, ...entry.aliases ]) {
        byAnyName.set(name.toLowerCase(), entry.code);
    }
}

/** The code this is, whatever it was typed as. Null for something that is not a language. */
export const resolveLanguage = (raw: string) => byAnyName.get(raw.trim().toLowerCase()) || null;

export const isLanguage = (raw: string) => resolveLanguage(raw) !== null;

/**
 * A stored list, with everything that is not a language dropped and the order and the
 * duplicates dealt with. Used on the way in: a code nothing can ever match would leave a
 * title on a watchlist for good with nothing to say why.
 */
export const cleanLanguageList = (value: string) => {
    const codes: string[] = [];

    for (const entry of value.split(",")) {
        const code = resolveLanguage(entry);

        if (code && ! codes.includes(code)) {
            codes.push(code);
        }
    }

    return codes.join(",");
};
