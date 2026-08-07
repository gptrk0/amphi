'use client';

import { Search } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

import { Input } from "./ui/input"

const SEARCH_PATH = "/search";
const DEBOUNCE_MS = 350;

const currentQuery = () => {
    if (typeof window === "undefined" || window.location.pathname !== SEARCH_PATH) {
        return "";
    }

    return new URLSearchParams(window.location.search).get("q") || "";
};

export function SearchBar(props: React.ComponentProps<"div">) {
    const router = useRouter();
    const pathname = usePathname();
    const inputRef = useRef<HTMLInputElement>(null);
    const [ value, setValue ] = useState("");

    // a shared /search?q=... link has to fill the input back in, leaving the page empties it
    useEffect(() => {
        setValue(pathname === SEARCH_PATH ? currentQuery() : "");
    }, [ pathname ]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "/" && ! (e.target instanceof HTMLInputElement) && ! (e.target instanceof HTMLTextAreaElement)) {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };

        window.addEventListener("keydown", onKeyDown);

        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    const navigate = useCallback((term: string) => {
        if (! term && pathname !== SEARCH_PATH) {
            return;
        }

        const target = term ? `${ SEARCH_PATH }?q=${ encodeURIComponent(term) }` : SEARCH_PATH;

        // typing further on the search page must not fill up the history
        if (pathname === SEARCH_PATH) {
            router.replace(target);
        } else {
            router.push(target);
        }
    }, [ pathname, router ]);

    useEffect(() => {
        const term = value.trim();

        const timer = setTimeout(() => {
            if (term !== currentQuery()) {
                navigate(term);
            }
        }, DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [ value, navigate ]);

    return (
        <div className="relative w-[300px]" {...props}>
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />

            <Input
                ref={inputRef}
                value={value}
                placeholder="Search for movies and shows..."
                className="pl-8"
                onChange={e => setValue(e.currentTarget.value)}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        navigate(e.currentTarget.value.trim());
                    } else if (e.key === "Escape") {
                        setValue("");
                        e.currentTarget.blur();
                    }
                }}
            />
        </div>
    );
}
