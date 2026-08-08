'use client';

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { GripVertical, X } from "lucide-react";
import classNames from "classnames";

/**
 * A comma separated setting, edited as tags. Half of these lists are order sensitive —
 * resolutions best first, languages first-one-wins, indexer priority — so an ordered list
 * can be dragged into place instead of being emptied and retyped to change one position.
 *
 * The value stays the raw comma separated string the setting itself uses: the page can go
 * on comparing strings to know what is dirty, and no parsing is duplicated.
 */

const split = (value: string) => value.split(",").map(entry => entry.trim()).filter(Boolean);

type Props = {
    value: string;
    onChange: (next: string) => void;
    // the order carries meaning, so offer to change it
    ordered?: boolean;
    placeholder?: string;
    // returns why a tag is not acceptable, or null
    validate?: (tag: string) => string | null;
};

export function TagInput({ value, onChange, ordered, placeholder, validate }: Props) {
    const tags = split(value);

    const [ draft, setDraft ] = useState("");
    const [ error, setError ] = useState("");

    const input = useRef<HTMLInputElement>(null);
    const dragged = useRef<number | null>(null);

    const write = (next: string[]) => onChange(next.join(","));

    /** False keeps the draft in the box, so a rejected entry is not lost. */
    const add = (raw: string) => {
        const wanted = split(raw);

        if (wanted.length === 0) {
            return true;
        }

        const next = [ ...tags ];

        for (const tag of wanted) {
            const problem = validate?.(tag);

            if (problem) {
                setError(problem);

                return false;
            }

            if (next.some(entry => entry.toLowerCase() === tag.toLowerCase())) {
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
        if (add(draft)) {
            setDraft("");
        }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();

            return;
        }

        // the quickest way to undo a typo is to take the tag back apart
        if (e.key === "Backspace" && draft === "" && tags.length > 0) {
            e.preventDefault();
            setDraft(tags[tags.length - 1]);
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

                        { tag }

                        <button
                            type="button"
                            className="cursor-pointer opacity-60 hover:opacity-100"
                            title={`Remove ${ tag }`}
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
                    placeholder={tags.length === 0 ? (placeholder || "empty") : ""}
                    autoComplete="off"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    onBlur={commit}
                />
            </div>

            {error
                ? <p className="text-destructive text-xs">{ error }</p>
                : ordered && tags.length > 1 && <p className="text-muted-foreground text-xs">Drag to reorder — the first one wins.</p>}
        </div>
    );
}
