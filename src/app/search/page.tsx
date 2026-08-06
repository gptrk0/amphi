'use client';

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";

import { MediaCard } from "@/components/media-card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Media } from "@/types/media";

function SearchResults() {
    const query = (useSearchParams().get("q") || "").trim();
    const [ items, setItems ] = useState<Media[]>();
    const [ page, setPage ] = useState(1);
    const [ totalPages, setTotalPages ] = useState(0);
    const [ loading, setLoading ] = useState(false);

    useEffect(() => {
        setPage(1);
        setItems(undefined);
    }, [ query ]);

    useEffect(() => {
        if (! query) {
            setItems([]);
            setTotalPages(0);

            return;
        }

        let cancelled = false;

        setLoading(true);

        axios.get("/api/search", { params: { q: query, page } })
            .then(res => {
                if (cancelled) {
                    return;
                }

                const found: Media[] = res.data.result || [];

                setItems(prev => page > 1 && prev ? [ ...prev, ...found ] : found);
                setTotalPages(res.data.totalPages || 0);
            })
            .catch(err => {
                console.error(err);

                if (! cancelled) {
                    setItems([]);
                }
            })
            .finally(() => {
                if (! cancelled) {
                    setLoading(false);
                }
            });

        return () => { cancelled = true; };
    }, [ query, page ]);

    return (
        <div className="p-4">
            <div className="flex items-center justify-between mb-5">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">Search results</h2>
                    <p className="text-sm text-muted-foreground">
                        {query
                            ? `Movies and shows matching "${ query }".`
                            : "Type something into the search bar above."}
                    </p>
                </div>
            </div>

            <Separator className="my-y" />

            {query && ! items && <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 pt-5">
                {Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-[3/4] w-full rounded-md" />
                ))}
            </div>}

            {query && items && items.length === 0 && (
                <p className="pt-5 text-sm text-muted-foreground">Nothing found for &quot;{ query }&quot;.</p>
            )}

            {items && items.length > 0 && <>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 pt-5">
                    {items.map(item => (
                        <MediaCard
                            key={`${ item.type }-${ item.id }`}
                            media={item}
                            aspectRatio="portrait"
                            width={250}
                            height={330}
                        />
                    ))}
                </div>

                {page < totalPages && (
                    <div className="flex justify-center pt-8">
                        <Button variant="outline" disabled={loading} onClick={() => setPage(page + 1)}>
                            {loading ? "Loading..." : "Load more"}
                        </Button>
                    </div>
                )}
            </>}
        </div>
    );
}

export default function Page() {
    return (
        <Suspense>
            <SearchResults />
        </Suspense>
    );
}
