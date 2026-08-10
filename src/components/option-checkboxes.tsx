'use client';

import { Checkbox } from "@/components/ui/checkbox";

/**
 * A comma separated value whose entries are known in advance — ticked, not typed. It used
 * to be a `TagInput` like every other list, which meant choosing notification events was
 * a spelling exercise: `redy` was accepted, stored, and silently sent nothing.
 *
 * The stored string is unchanged, so nothing downstream knows the difference. `*` is what
 * an install that asked for everything already has and arrives here as everything ticked;
 * untick one and the list is written out in full, because "all of them except that one"
 * has no shorthand. An entry that is not on the list — a typo from before this existed —
 * is not shown and is dropped the first time anything here is touched.
 */

const ACCEPT_ALL = "*";

const split = (value: string) => value.split(",").map(entry => entry.trim().toLowerCase()).filter(Boolean);

export type CheckboxOption = { value: string, label: string, help?: string };

type Props = {
    value: string;
    onChange: (next: string) => void;
    options: readonly CheckboxOption[];
};

export function OptionCheckboxes({ value, onChange, options }: Props) {
    const chosen = split(value);
    const all = chosen.includes(ACCEPT_ALL);

    const isOn = (option: CheckboxOption) => all || chosen.includes(option.value);

    const toggle = (option: CheckboxOption, on: boolean) => {
        // written out in the order they are declared in, not in the order they were
        // ticked — the value is read by people too
        const next = options
            .filter(entry => entry.value === option.value ? on : isOn(entry))
            .map(entry => entry.value);

        onChange(next.join(","));
    };

    return (
        <div className="space-y-2">
            {options.map(option => (
                <label key={option.value} className="flex cursor-pointer items-start gap-2">
                    <Checkbox
                        className="mt-0.5 cursor-pointer"
                        checked={isOn(option)}
                        onCheckedChange={(checked) => toggle(option, checked === true)}
                    />

                    <span className="min-w-0 text-sm">
                        { option.label }
                        {option.help && <span className="text-muted-foreground"> — { option.help }</span>}
                    </span>
                </label>
            ))}
        </div>
    );
}
