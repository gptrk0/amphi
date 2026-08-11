'use client';

import { useEffect, useRef, useState } from "react";
import axios from "axios";

import { MediaCard } from "@/components/media-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/context/locale";
import { cached, remember } from "@/lib/browse-cache";
import { Media } from "@/types/media";

type Props = {
    type: string;
    category: string;
    genre?: string | null;
};

const key = (media: Media) => `${ media.type }-${ media.id }`;

type Shown = { items: Media[], page: number, totalPages: number };

/**
 * The call site keys this on what it is showing, so a change of genre is a fresh mount
 * rather than something to reset — which is what lets the cache be read straight into the
 * initial state. Coming back to a grid four pages deep gets all four back: the position on
 * the page is meaningless without them, and refetching page one would throw them away.
 */
export function MediaGrid({ type, category, genre }: Props) {
    const { t } = useLocale();
    const cacheKey = `grid:${ type }:${ category }:${ genre || "" }`;
    const was = cached<Shown>(cacheKey);

    const [ items, setItems ] = useState<Media[] | undefined>(was?.items);
    const [ page, setPage ] = useState(was?.page ?? 1);
    const [ totalPages, setTotalPages ] = useState(was?.totalPages ?? 0);
    const [ loading, setLoading ] = useState(false);
    const sentinel = useRef<HTMLDivElement>(null);

    // what is already in `items`, so the pages that came from the cache are not fetched
    // a second time. A ref because the fetch effect has to see it in the same commit
    const loaded = useRef(was?.page ?? 0);
    const shown = useRef<Media[]>(was?.items ?? []);

    useEffect(() => {
        if (page <= loaded.current) {
            return;
        }

        let cancelled = false;

        setLoading(true);

        axios.get("/api/discover", { params: { type, category, genre, page } })
            .then(res => {
                if (cancelled) {
                    return;
                }

                const found: Media[] = res.data.result || [];
                const seen = new Set(shown.current.map(key));

                // tmdb repeats items across pages when popularity shifts under us
                const merged = page === 1
                    ? found
                    : [ ...shown.current, ...found.filter(v => ! seen.has(key(v))) ];

                shown.current = merged;
                loaded.current = page;

                setItems(merged);
                setTotalPages(res.data.totalPages || 0);

                remember<Shown>(cacheKey, { items: merged, page, totalPages: res.data.totalPages || 0 });
            })
            .catch(err => {
                console.error(err);

                if (! cancelled) {
                    setItems(prev => prev || []);
                }
            })
            .finally(() => {
                if (! cancelled) {
                    setLoading(false);
                }
            });

        return () => { cancelled = true; };
    }, [ cacheKey, type, category, genre, page ]);

    useEffect(() => {
        const node = sentinel.current;

        if (! node || loading || page >= totalPages) {
            return;
        }

        const observer = new IntersectionObserver(entries => {
            if (entries[0]?.isIntersecting) {
                setPage(current => current + 1);
            }
        }, { rootMargin: "400px" });

        observer.observe(node);

        return () => observer.disconnect();
    }, [ loading, page, totalPages ]);

    if (items && items.length === 0) {
        return <p className="pt-5 text-sm text-muted-foreground">{ t("discover.empty") }</p>;
    }

    return (
        <>
            {/* three across on a phone instead of two: a third narrower per card */}
            <div className="grid grid-cols-3 gap-3 pt-5 md:grid-cols-4 md:gap-6 lg:grid-cols-6">
                {items?.map(item => (
                    <MediaCard
                        key={key(item)}
                        media={item}
                        aspectRatio="portrait"
                        width={250}
                        height={330}
                    />
                ))}

                {loading && Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton key={`skeleton-${ i }`} className="aspect-[3/4] w-full rounded-md" />
                ))}
            </div>

            <div ref={sentinel} className="h-px" />
        </>
    );
}
