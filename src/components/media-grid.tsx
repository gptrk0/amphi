'use client';

import { useEffect, useRef, useState } from "react";
import axios from "axios";

import { MediaCard } from "@/components/media-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Media } from "@/types/media";

type Props = {
    type: string;
    category: string;
    genre?: string | null;
};

const key = (media: Media) => `${ media.type }-${ media.id }`;

export function MediaGrid({ type, category, genre }: Props) {
    const [ items, setItems ] = useState<Media[]>();
    const [ page, setPage ] = useState(1);
    const [ totalPages, setTotalPages ] = useState(0);
    const [ loading, setLoading ] = useState(false);
    const sentinel = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setPage(1);
        setItems(undefined);
    }, [ type, category, genre ]);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);

        axios.get("/api/discover", { params: { type, category, genre, page } })
            .then(res => {
                if (cancelled) {
                    return;
                }

                const found: Media[] = res.data.result || [];

                // tmdb repeats items across pages when popularity shifts under us
                setItems(prev => {
                    if (page === 1 || ! prev) {
                        return found;
                    }

                    const seen = new Set(prev.map(key));

                    return [ ...prev, ...found.filter(v => ! seen.has(key(v))) ];
                });

                setTotalPages(res.data.totalPages || 0);
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
    }, [ type, category, genre, page ]);

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
        return <p className="pt-5 text-sm text-muted-foreground">Nothing to show here.</p>;
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
