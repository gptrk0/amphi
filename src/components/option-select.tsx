'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import classNames from "classnames";

import { useLocale } from "@/context/locale";
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
    /**
     * For a trigger inside something that clips: a table container is `overflow-x-auto`,
     * and `overflow-x` on its own still turns `overflow-y` into a scroll box — so an
     * absolutely positioned popup in the last row is cut off by the table's edge. With
     * this the popup is placed against the viewport instead, and a scroll closes it
     * rather than leaving it behind where the trigger used to be.
     */
    float?: boolean;
};

export function OptionSelect({ value, onChange, options, float = false }: Props) {
    const { t } = useLocale();
    const [ open, setOpen ] = useState(false);
    const [ query, setQuery ] = useState("");
    const [ active, setActive ] = useState(0);
    const [ at, setAt ] = useState<{ top: number, left: number, width: number }>();

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

    /**
     * A floating popup is placed once, on open, and a scroll *of the page* closes it: it
     * is positioned against the viewport, so it would otherwise sit where the trigger no
     * longer is.
     *
     * The option list has its own scrollbar, and a scroll inside it must not count. Scroll
     * events do not bubble, but a capture listener on `window` sees them anyway — so the
     * first version of this closed the moment anybody tried to scroll the list, which is
     * the one thing a long list of languages is for. The popup is a DOM child of the
     * trigger's box even while it is drawn against the viewport, so `contains` is what
     * tells the two apart.
     */
    useEffect(() => {
        if (! open || ! float) {
            return;
        }

        const rect = box.current?.getBoundingClientRect();

        if (rect) {
            setAt({ top: rect.bottom + 4, left: rect.left, width: rect.width });
        }

        const away = (event: Event) => {
            if (event.target instanceof Node && box.current?.contains(event.target)) {
                return;
            }

            setOpen(false);
        };

        window.addEventListener("scroll", away, true);
        window.addEventListener("resize", away);

        return () => {
            window.removeEventListener("scroll", away, true);
            window.removeEventListener("resize", away);
        };
    }, [ open, float ]);

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
                    { chosen ? chosen.label : (value ? t("input.notOnList", { value }) : t("input.pick")) }
                </span>

                {chosen && <span className="text-muted-foreground text-xs">{ chosen.value }</span>}

                <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
            </button>

            {open && (
                <div
                    className={classNames(
                        "bg-popover text-popover-foreground z-50 rounded-md border p-1 shadow-md",
                        float ? "fixed" : "absolute mt-1 w-full"
                    )}
                    style={float && at ? { top: at.top, left: at.left, width: at.width } : undefined}
                >
                    <input
                        ref={search}
                        className="placeholder:text-muted-foreground w-full bg-transparent px-2 py-1.5 text-sm outline-none"
                        value={query}
                        placeholder={t("input.search")}
                        autoComplete="off"
                        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                        onKeyDown={onKeyDown}
                    />

                    {/* overscroll-contain: at the end of the list the wheel would otherwise
                        scroll the page instead, which — for a floating popup — closes it */}
                    <div role="listbox" className="max-h-56 overflow-auto overscroll-contain">
                        {matches.length === 0 && (
                            <p className="text-muted-foreground px-2 py-1.5 text-sm">{ t("input.nothing") }</p>
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
