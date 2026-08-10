/**
 * The closed value sets the two dropdowns share: [TagInput](src/components/tag-input.tsx)
 * for a list of them and [OptionSelect](src/components/option-select.tsx) for exactly one.
 *
 * Both are the same problem — the stored value is a code (`hun`) and a person types a name
 * (`Hungarian`, `magyar`, `hu`) — so the matching lives here instead of twice in two
 * components that would drift apart.
 */

export type TagOption = {
    value: string;
    label: string;
    // other spellings that should find it: an alias, another code, a native name
    keywords?: string[];
};

const namesOf = (option: TagOption) => [ option.value, option.label, ...(option.keywords || []) ];

/** Every spelling of every option, pointing at what gets stored. */
export const optionIndex = (options: readonly TagOption[]) => {
    const names = new Map<string, string>();

    for (const option of options) {
        for (const name of namesOf(option)) {
            names.set(name.toLowerCase(), option.value);
        }
    }

    return names;
};

export const optionLabel = (options: readonly TagOption[], value: string) => {
    return options.find(option => option.value === value)?.label || value;
};

/** What the list shows: never something already taken, filtered by any of its spellings. */
export const matchOptions = (options: readonly TagOption[], query: string, taken: string[] = []) => {
    const wanted = query.trim().toLowerCase();

    return options
        .filter(option => ! taken.includes(option.value))
        .filter(option => ! wanted || namesOf(option).some(name => name.toLowerCase().includes(wanted)));
};
