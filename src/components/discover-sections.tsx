'use client';

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { KeyRound } from "lucide-react";

import { MediaHero } from "@/components/media-hero";
import { MediaRow } from "@/components/media-row";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchlist } from "@/context/watchlist";
import { Section } from "@/lib/sections";
import { Media } from "@/types/media";

/**
 * A first run has no api key, so every row comes back empty — and an empty page with a
 * hero skeleton that never resolves reads as broken. This says what is missing instead.
 */
function SetupNotice() {
    return (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
            <KeyRound className="text-muted-foreground size-8" />

            <div className="space-y-1">
                <h2 className="text-xl font-semibold tracking-tight">Add a TMDB API key to get started</h2>
                <p className="text-muted-foreground max-w-md text-sm">
                    Every poster, title and release date comes from TMDB, so nothing can be listed
                    until the key is in. It is free — sign up at themoviedb.org, then paste the key
                    on the settings page.
                </p>
            </div>

            <Button asChild>
                <Link href="/settings#tmdb">Open settings</Link>
            </Button>
        </div>
    );
}

export function DiscoverSections({ view }: { view: string }) {
    const { revision } = useWatchlist();
    const [ hero, setHero ] = useState<Media | null>(null);
    const [ sections, setSections ] = useState<Section[]>();
    const [ needsTmdb, setNeedsTmdb ] = useState(false);

    // the library rows are built from the watchlist, so a change anywhere reloads
    // them. `revision` counts actual changes: keying this on the list itself meant
    // the watchlist arriving after mount looked like one, and the whole page was
    // built twice on every visit.
    useEffect(() => {
        let cancelled = false;

        axios.get("/api/discover/sections", { params: { view } })
            .then(res => {
                if (cancelled) {
                    return;
                }

                setHero(res.data.hero || null);
                setSections(res.data.sections || []);
                setNeedsTmdb(res.data.setup?.tmdb === false);
            })
            .catch(err => {
                console.error(err);

                if (! cancelled) {
                    setSections([]);
                }
            });

        return () => { cancelled = true; };
    }, [ view, revision ]);

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
                        title={section.title}
                        description={section.description}
                        href={section.href}
                        items={section.items}
                    />
                ))}
            </div>
        </>
    );
}
