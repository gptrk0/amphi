'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import classNames from "classnames";

import { matchOptions, TagOption } from "@/lib/options";

/**
 * Exactly one value out of a closed set, searchable — the single-value twin of the
 * `TagInput` dropdown, sharing its matching and its look.
 *
 * **Why not the browser's own `select`.** It was one, and it was wrong twice. The popup list
 * is drawn by the browser, so in the dark theme it came up white with the theme's light text
 * in it; and a stored value that is not among the options makes a `select` *display* its
 * first one while the state still holds the old value — the field would have said "Hungarian"
 * and saved something else. This says `not set` instead, out loud, and only ever reports a
 * value somebody picked.
 *
 * (The theme half is fixed for every native control now — `color-scheme` in globals.css —
 * but the silent mismatch is a `select` property, so this stays.)
 */

type Props = {
    value: string;
    onChange: (next: string) => void;
    options: readonly TagOption[];
    // what one of them is, for the empty state: "pick a language"
    noun?: string;
};

export function OptionSelect({ value, onChange, options, noun = "value" }: Props) {
    const [ open, setOpen ] = useState(false);
    const [ query, setQuery ] = useState("");
    const [ active, setActive ] = useState(0);

    const box = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);

    const chosen = options.find(option => option.value === value);
    const matches = useMemo(() => matchOptions(options, query), [ options, query ]);
    const highlighted = Math.min(active, Math.max(matches.length - 1, 0));

    // a click anywhere else closes it. Pointerdown rather than click, so it does not
    // close and reopen when the pointer goes down on the trigger itself
    useEffect(() => {
        if (! open) {
            return;
        }

        const away = (event: PointerEvent) => {
            if (! box.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        window.addEventListener("pointerdown", away);

        return () => window.removeEventListener("pointerdown", away);
    }, [ open ]);

    useEffect(() => {
        if (open) {
            search.current?.focus();
        }
    }, [ open ]);

    const pick = (option: TagOption) => {
        onChange(option.value);
        setQuery("");
        setActive(0);
        setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();

            if (matches.length > 0) {
                setActive((highlighted + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
            }

            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();

            if (matches.length > 0) {
                pick(matches[highlighted]);
            }

            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
        }
    };

    return (
        <div className="relative" ref={box}>
            <button
                type="button"
                className="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
                onClick={() => setOpen(current => ! current)}
            >
                <span className={classNames({ "text-muted-foreground": ! chosen })}>
                    { chosen ? chosen.label : (value ? `not set — "${ value }" is not a ${ noun }` : `pick a ${ noun }`) }
                </span>

                {chosen && <span className="text-muted-foreground text-xs">{ chosen.value }</span>}

                <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
            </button>

            {open && (
                <div className="bg-popover text-popover-foreground absolute z-50 mt-1 w-full rounded-md border p-1 shadow-md">
                    <input
                        ref={search}
                        className="placeholder:text-muted-foreground w-full bg-transparent px-2 py-1.5 text-sm outline-none"
                        value={query}
                        placeholder="Search…"
                        autoComplete="off"
                        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                        onKeyDown={onKeyDown}
                    />

                    <div role="listbox" className="max-h-56 overflow-auto">
                        {matches.length === 0 && (
                            <p className="text-muted-foreground px-2 py-1.5 text-sm">Nothing matches that.</p>
                        )}

                        {matches.map((option, i) => (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={option.value === value}
                                className={classNames(
                                    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                                    { "bg-accent text-accent-foreground": i === highlighted }
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
                </div>
            )}
        </div>
    );
}
