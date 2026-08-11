'use client';

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";

import { MediaCard } from "@/components/media-card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/context/locale";
import { cached, remember } from "@/lib/browse-cache";
import { Media } from "@/types/media";

type Shown = { items: Media[], page: number, totalPages: number };

/**
 * One query's results. Keyed on the query by the component above, so a new search is a new
 * mount and what the cache holds can be read straight into the initial state — including
 * however many times "Load more" was pressed, which is the part that made coming back from
 * a details page lose its place.
 */
function Results({ query }: { query: string }) {
    const { t } = useLocale();
    const cacheKey = `search:${ query }`;
    const was = query ? cached<Shown>(cacheKey) : undefined;

    const [ items, setItems ] = useState<Media[] | undefined>(was?.items);
    const [ page, setPage ] = useState(was?.page ?? 1);
    const [ totalPages, setTotalPages ] = useState(was?.totalPages ?? 0);
    const [ loading, setLoading ] = useState(false);

    // what is already in `items`: the pages the cache brought back are not asked for again
    const loaded = useRef(was?.page ?? 0);
    const shown = useRef<Media[]>(was?.items ?? []);

    useEffect(() => {
        if (! query) {
            setItems([]);
            setTotalPages(0);

            return;
        }

        if (page <= loaded.current) {
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
                const merged = page > 1 ? [ ...shown.current, ...found ] : found;
                const pages = res.data.totalPages || 0;

                shown.current = merged;
                loaded.current = page;

                setItems(merged);
                setTotalPages(pages);

                remember<Shown>(cacheKey, { items: merged, page, totalPages: pages });
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
    }, [ cacheKey, query, page ]);

    return (
        <div className="p-4">
            <div className="flex items-center justify-between mb-5">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">{ t("search.title") }</h2>
                    <p className="text-sm text-muted-foreground">
                        {query
                            ? t("search.matching", { query })
                            : t("search.prompt")}
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
                <p className="pt-5 text-sm text-muted-foreground">{ t("search.nothing", { query }) }</p>
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
                        <Button variant="outline" className="cursor-pointer" disabled={loading} onClick={() => setPage(page + 1)}>
                            { loading ? t("search.loading") : t("search.loadMore") }
                        </Button>
                    </div>
                )}
            </>}
        </div>
    );
}

function SearchResults() {
    const query = (useSearchParams().get("q") || "").trim();

    return <Results key={query} query={query} />;
}

export default function Page() {
    return (
        <Suspense>
            <SearchResults />
        </Suspense>
    );
}
