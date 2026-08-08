'use client';

import { useEffect, useState } from "react";
import axios from "axios";

import { MediaHero } from "@/components/media-hero";
import { MediaRow } from "@/components/media-row";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchlist } from "@/context/watchlist";
import { Section } from "@/lib/sections";
import { Media } from "@/types/media";

export function DiscoverSections({ view }: { view: string }) {
    const { revision } = useWatchlist();
    const [ hero, setHero ] = useState<Media | null>(null);
    const [ sections, setSections ] = useState<Section[]>();

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
            })
            .catch(err => {
                console.error(err);

                if (! cancelled) {
                    setSections([]);
                }
            });

        return () => { cancelled = true; };
    }, [ view, revision ]);

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
