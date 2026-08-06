'use client';

import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import axios from "axios";

import { DiscoverSections } from "@/components/discover-sections";
import { MediaGrid } from "@/components/media-grid";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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

    const [ genres, setGenres ] = useState<MediaGenre[]>([]);
    const [ selected, setSelected ] = useState<number | null>(null);

    useEffect(() => {
        setSelected(null);

        if (! view) {
            return;
        }

        let cancelled = false;

        axios.get("/api/genres", { params: { type: view.type } })
            .then(res => {
                if (! cancelled) {
                    setGenres(res.data.result || []);
                }
            })
            .catch(err => console.error(err));

        return () => { cancelled = true; };
    }, [ view ]);

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
                                onClick={() => setSelected(genre.id === selected ? null : genre.id)}
                            >
                                { genre.name }
                            </Button>
                        ))}
                    </div>

                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            )}

            {selected
                ? <MediaGrid type={view.type} category="popular" genre={String(selected)} />
                : <DiscoverSections view={slug} />}
        </div>
    );
}
