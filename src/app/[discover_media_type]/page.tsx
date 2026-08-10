'use client';

import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import axios from "axios";

import { DiscoverSections } from "@/components/discover-sections";
import { MediaGrid } from "@/components/media-grid";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cached, remember } from "@/lib/browse-cache";
import { MediaGenre } from "@/types/media";

const VIEWS: Record<string, { title: string, description: string, type: "movie" | "tv" }> = {
    movies: {
        title: "Movies",
        description: "Browse what is out and what is coming.",
        type: "movie"
    },
    series: {
        title: "Series",
        description: "Browse what is on and what is next.",
        type: "tv"
    }
};

export default function Page() {
    const { discover_media_type } = useParams();
    const slug = typeof discover_media_type === "string" ? discover_media_type : "";
    const view = VIEWS[slug];

    const genreKey = `genres:${ view?.type || "" }`;

    const [ genres, setGenres ] = useState<MediaGenre[]>(cached<MediaGenre[]>(genreKey) || []);
    const [ selected, setSelected ] = useState<number | null>(null);

    // The chosen genre lives in the URL, because it has to survive the round trip through
    // a details page — until now it was component state, so coming back turned the
    // filtered grid into the unfiltered rows and there was nothing left to scroll back to.
    //
    // Read from `window.location` rather than `useSearchParams` on purpose: this page has
    // no Suspense boundary above it, and one would have to be invented for a value that is
    // only ever read on mount.
    useEffect(() => {
        const wanted = new URLSearchParams(window.location.search).get("genre");

        setSelected(wanted ? Number(wanted) || null : null);

        if (! view) {
            return;
        }

        let cancelled = false;

        axios.get("/api/genres", { params: { type: view.type } })
            .then(res => {
                if (! cancelled) {
                    setGenres(res.data.result || []);
                    remember(genreKey, res.data.result || []);
                }
            })
            .catch(err => console.error(err));

        return () => { cancelled = true; };
    }, [ genreKey, view ]);

    // replaceState, not a router push: it is the same list either way, and a history entry
    // per chip would mean pressing back five times to leave the page
    const pick = (id: number | null) => {
        setSelected(id);

        window.history.replaceState(window.history.state, "", id ? `?genre=${ id }` : window.location.pathname);
    };

    if (! view) {
        notFound();
    }

    const active = genres.find(genre => genre.id === selected);

    return (
        <div className="p-4">
            <div className="mb-5 space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">{ view.title }</h2>
                <p className="text-sm text-muted-foreground">
                    {active
                        ? `${ active.name }, most popular first.`
                        : view.description}
                </p>
            </div>

            {genres.length > 0 && (
                <ScrollArea className="mb-6">
                    <div className="flex gap-2 pb-3">
                        {genres.map(genre => (
                            <Button
                                key={genre.id}
                                size="sm"
                                variant={genre.id === selected ? "default" : "outline"}
                                className="shrink-0 rounded-full"
                                onClick={() => pick(genre.id === selected ? null : genre.id)}
                            >
                                { genre.name }
                            </Button>
                        ))}
                    </div>

                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            )}

            {/* keyed on what they are showing: a fresh mount reads its own cache into its
                initial state, so neither has a reset path to get wrong */}
            {selected
                ? <MediaGrid key={`${ view.type }-${ selected }`} type={view.type} category="popular" genre={String(selected)} />
                : <DiscoverSections key={slug} view={slug} />}
        </div>
    );
}
