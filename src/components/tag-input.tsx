'use client';

import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ChevronDown, GripVertical, X } from "lucide-react";
import classNames from "classnames";

import { useLocale } from "@/context/locale";
import { matchOptions, optionIndex, optionLabel, TagOption } from "@/lib/options";

/**
 * A comma separated setting, edited as tags. Half of these lists are order sensitive —
 * resolutions best first, languages first-one-wins, indexer priority — so an ordered list
 * can be dragged into place instead of being emptied and retyped to change one position.
 *
 * The value stays the raw comma separated string the setting itself uses: the page can go
 * on comparing strings to know what is dirty, and no parsing is duplicated.
 *
 * **With `options` it becomes a closed list.** Anything typed has to be one of them, and
 * the box offers the whole set in a searchable dropdown. That is for the values where a
 * free text field was actively misleading: a language is stored as `hun`, so typing
 * `hungarian` or `hu` used to be accepted, saved, and then matched nothing for as long as
 * nobody wondered why. Now all three find the same entry, and a word that is not a language
 * at all cannot be added. The tag shows the readable name and keeps the stored code in its
 * tooltip.
 */

const split = (value: string) => value.split(",").map(entry => entry.trim()).filter(Boolean);

export type { TagOption };

type Props = {
    value: string;
    onChange: (next: string) => void;
    // the order carries meaning, so offer to change it
    ordered?: boolean;
    placeholder?: string;
    // returns why a tag is not acceptable, or null
    validate?: (tag: string) => string | null;
    // a closed set: only these can be added, and they are offered in a dropdown
    options?: readonly TagOption[];
};

export function TagInput({ value, onChange, ordered, placeholder, validate, options }: Props) {
    const { t } = useLocale();
    const tags = split(value);

    const [ draft, setDraft ] = useState("");
    const [ error, setError ] = useState("");
    const [ open, setOpen ] = useState(false);
    const [ active, setActive ] = useState(0);

    const input = useRef<HTMLInputElement>(null);
    const dragged = useRef<number | null>(null);

    // every spelling of every option, so what is typed and what is stored can differ
    const byName = useMemo(() => optionIndex(options || []), [ options ]);

    const labelOf = (tag: string) => options ? optionLabel(options, tag) : tag;

    /** What is typed, as it will be stored. Null for something that is not on the list. */
    const resolve = (raw: string) => {
        const tag = raw.trim();

        if (! options) {
            return tag;
        }

        return byName.get(tag.toLowerCase()) || null;
    };

    const write = (next: string[]) => onChange(next.join(","));

    /** False keeps the draft in the box, so a rejected entry is not lost. */
    const add = (raw: string) => {
        const wanted = split(raw);

        if (wanted.length === 0) {
            return true;
        }

        const next = [ ...tags ];

        for (const entry of wanted) {
            const tag = resolve(entry);

            if (! tag) {
                setError(t("input.notOnListTag", { value: entry }));

                return false;
            }

            const problem = validate?.(tag);

            if (problem) {
                setError(problem);

                return false;
            }

            if (next.some(already => already.toLowerCase() === tag.toLowerCase())) {
                continue;
            }

            next.push(tag);
        }

        setError("");
        write(next);

        return true;
    };

    const remove = (index: number) => {
        setError("");
        write(tags.filter((_, i) => i !== index));
    };

    const move = (from: number, to: number) => {
        if (from === to || to < 0 || to >= tags.length) {
            return;
        }

        const next = [ ...tags ];
        const [ moved ] = next.splice(from, 1);

        next.splice(to, 0, moved);
        write(next);
    };

    const commit = () => {
        if (! add(draft)) {
            return false;
        }

        setDraft("");

        return true;
    };

    // what the dropdown is showing: never something already added, and filtered by
    // whatever has been typed so far — against every spelling, not only the label
    const matches = useMemo(() => matchOptions(options || [], draft, tags), [ options, tags, draft ]);

    const pick = (option: TagOption) => {
        setDraft("");
        setActive(0);
        add(option.value);
        input.current?.focus();
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (options && open && matches.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setActive(current => (current + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);

            return;
        }

        if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);

            return;
        }

        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();

            // the highlighted row wins over the half typed word it was filtered by
            if (options && open && matches.length > 0) {
                pick(matches[Math.min(active, matches.length - 1)]);

                return;
            }

            commit();

            return;
        }

        // the quickest way to undo a typo is to take the tag back apart
        if (e.key === "Backspace" && draft === "" && tags.length > 0) {
            e.preventDefault();
            setDraft(labelOf(tags[tags.length - 1]));
            remove(tags.length - 1);
        }
    };

    // pasting a whole list, which is how these values arrive from an old env file
    const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData("text");

        if (! text.includes(",")) {
            return;
        }

        e.preventDefault();
        add(text);
    };

    return (
        <div className="space-y-1.5">
            <div className="relative">
                <div
                    className="border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]"
                    onClick={() => input.current?.focus()}
                >
                    {tags.map((tag, i) => (
                        <span
                            key={`${ tag }-${ i }`}
                            draggable={ordered}
                            onDragStart={() => { dragged.current = i; }}
                            onDragEnter={() => {
                                if (dragged.current !== null && dragged.current !== i) {
                                    move(dragged.current, i);
                                    dragged.current = i;
                                }
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDragEnd={() => { dragged.current = null; }}
                            // the stored code, for whoever knows this app by its codes
                            title={options ? tag : undefined}
                            className={classNames(
                                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
                                {
                                    // `*` means "accept everything", which is worth seeing at a glance
                                    "border-transparent bg-primary text-primary-foreground": tag === "*",
                                    "border-transparent bg-secondary text-secondary-foreground": tag !== "*",
                                    "cursor-grab active:cursor-grabbing": ordered
                                }
                            )}
                        >
                            {ordered && <GripVertical className="size-3 opacity-50" />}

                            { labelOf(tag) }

                            <button
                                type="button"
                                className="cursor-pointer opacity-60 hover:opacity-100"
                                title={`Remove ${ labelOf(tag) }`}
                                onClick={(e) => { e.stopPropagation(); remove(i); }}
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}

                    <input
                        ref={input}
                        className="placeholder:text-muted-foreground min-w-24 flex-1 bg-transparent outline-none"
                        value={draft}
                        placeholder={tags.length === 0 ? (placeholder || t("input.empty")) : ""}
                        autoComplete="off"
                        onChange={(e) => {
                            setDraft(e.target.value);
                            setActive(0);
                            setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={onKeyDown}
                        onPaste={onPaste}
                        onBlur={() => {
                            setOpen(false);

                            // with a list on screen there is nothing to tell somebody who
                            // clicked away mid-word, so the half typed draft simply goes
                            if (! commit() && options) {
                                setDraft("");
                                setError("");
                            }
                        }}
                    />

                    {options && (
                        <button
                            type="button"
                            className="cursor-pointer opacity-50 hover:opacity-100"
                            title="Show the list"
                            // mousedown, not click: the input must not blur first, or the
                            // dropdown would close on the way to opening
                            onMouseDown={(e) => {
                                e.preventDefault();
                                input.current?.focus();
                                setOpen(current => ! current);
                            }}
                        >
                            <ChevronDown className="size-4" />
                        </button>
                    )}
                </div>

                {options && open && matches.length > 0 && (
                    <div
                        role="listbox"
                        className="bg-popover text-popover-foreground absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border p-1 shadow-md"
                    >
                        {matches.map((option, i) => (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={i === Math.min(active, matches.length - 1)}
                                className={classNames(
                                    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                                    { "bg-accent text-accent-foreground": i === Math.min(active, matches.length - 1) }
                                )}
                                onMouseEnter={() => setActive(i)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pick(option)}
                            >
                                { option.label }
                                <span className="text-muted-foreground ml-auto text-xs">{ option.value }</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {error
                ? <p className="text-destructive text-xs">{ error }</p>
                : ordered && tags.length > 1 && <p className="text-muted-foreground text-xs">{ t("input.reorder") }</p>}
        </div>
    );
}
