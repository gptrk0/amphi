'use client';

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { KeyRound } from "lucide-react";

import { MediaHero } from "@/components/media-hero";
import { MediaRow } from "@/components/media-row";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/context/locale";
import { useWatchlist } from "@/context/watchlist";
import { cached, remember } from "@/lib/browse-cache";
import { Section } from "@/lib/sections";
import { Media } from "@/types/media";

/**
 * A first run has no api key, so every row comes back empty — and an empty page with a
 * hero skeleton that never resolves reads as broken. This says what is missing instead.
 */
function SetupNotice() {
    const { t } = useLocale();

    return (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
            <KeyRound className="text-muted-foreground size-8" />

            <div className="space-y-1">
                <h2 className="text-xl font-semibold tracking-tight">{ t("discover.setup.title") }</h2>
                <p className="text-muted-foreground max-w-md text-sm">{ t("discover.setup.body") }</p>
            </div>

            <Button asChild>
                <Link href="/settings#tmdb">{ t("discover.setup.open") }</Link>
            </Button>
        </div>
    );
}

type Shown = { hero: Media | null, sections: Section[] };

/**
 * `view` never changes for a mounted one of these — the call sites key on it — so what
 * the cache is read into is the initial state and there is no resetting to do.
 */
export function DiscoverSections({ view }: { view: string }) {
    const { revision } = useWatchlist();
    const { tOr } = useLocale();
    const key = `sections:${ view }`;
    const was = cached<Shown>(key);

    const [ hero, setHero ] = useState<Media | null>(was?.hero ?? null);
    const [ sections, setSections ] = useState<Section[] | undefined>(was?.sections);
    const [ needsTmdb, setNeedsTmdb ] = useState(false);

    // the library rows are built from the watchlist, so a change anywhere reloads
    // them. `revision` counts actual changes: keying this on the list itself meant
    // the watchlist arriving after mount looked like one, and the whole page was
    // built twice on every visit.
    //
    // It refetches even when the cache has already drawn the page — what the cache buys
    // is the height and the first paint, not the freshness of a trending row.
    useEffect(() => {
        let cancelled = false;

        axios.get("/api/discover/sections", { params: { view } })
            .then(res => {
                if (cancelled) {
                    return;
                }

                const shown: Shown = { hero: res.data.hero || null, sections: res.data.sections || [] };

                setHero(shown.hero);
                setSections(shown.sections);
                setNeedsTmdb(res.data.setup?.tmdb === false);

                remember(key, shown);
            })
            .catch(err => {
                console.error(err);

                if (! cancelled) {
                    setSections(prev => prev || []);
                }
            });

        return () => { cancelled = true; };
    }, [ key, view, revision ]);

    if (needsTmdb) {
        return <SetupNotice />;
    }

    return (
        <>
            {hero
                ? <MediaHero media={hero} />
                : <Skeleton className="mb-10 h-[300px] w-full rounded-lg md:h-[420px]" />}

            <div className="grid grid-cols-1 gap-10">
                {! sections && Array.from({ length: 3 }).map((_, i) => (
                    <MediaRow key={i} title="" />
                ))}

                {sections?.map(section => (
                    <MediaRow
                        key={section.key}
                        // by the row's key, with what the server sent as the fallback
                        title={tOr(`discover.sections.${ section.key }.title`, section.title)}
                        description={tOr(`discover.sections.${ section.key }.description`, section.description)}
                        href={section.href}
                        items={section.items}
                    />
                ))}
            </div>
        </>
    );
}
