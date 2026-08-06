'use client';

import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import axios from "axios";

import { MediaGrid } from "@/components/media-grid";
import { MediaRow } from "@/components/media-row";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { MediaGenre } from "@/types/media";

type Section = {
    title: string;
    description: string;
    // "all" has no genre list of its own: tmdb genre ids differ between movie and tv
    type: string;
    rows: { title: string, type: string, category: string }[];
};

const SECTIONS: Record<string, Section> = {
    all: {
        title: "Discover",
        description: "Top picks for you.",
        type: "all",
        rows: [
            { title: "Trending today", type: "all", category: "trending" },
            { title: "Popular movies", type: "movie", category: "popular" },
            { title: "Popular series", type: "tv", category: "popular" },
            { title: "Upcoming movies", type: "movie", category: "upcoming" }
        ]
    },
    movies: {
        title: "Movies",
        description: "Browse what is out and what is coming.",
        type: "movie",
        rows: [
            { title: "Trending today", type: "movie", category: "trending" },
            { title: "Popular", type: "movie", category: "popular" },
            { title: "Now playing", type: "movie", category: "now_playing" },
            { title: "Upcoming", type: "movie", category: "upcoming" },
            { title: "Top rated", type: "movie", category: "top_rated" }
        ]
    },
    series: {
        title: "Series",
        description: "Browse what is on and what is next.",
        type: "tv",
        rows: [
            { title: "Trending today", type: "tv", category: "trending" },
            { title: "Popular", type: "tv", category: "popular" },
            { title: "Airing today", type: "tv", category: "airing_today" },
            { title: "On the air", type: "tv", category: "on_the_air" },
            { title: "Top rated", type: "tv", category: "top_rated" }
        ]
    }
};

export default function Page() {
    const { discover_media_type } = useParams();
    const slug = typeof discover_media_type === "string" ? discover_media_type : "all";
    const section = SECTIONS[slug];

    const [ genres, setGenres ] = useState<MediaGenre[]>([]);
    const [ selected, setSelected ] = useState<number | null>(null);

    useEffect(() => {
        setSelected(null);

        if (! section || section.type === "all") {
            setGenres([]);

            return;
        }

        let cancelled = false;

        axios.get("/api/genres", { params: { type: section.type } })
            .then(res => {
                if (! cancelled) {
                    setGenres(res.data.result || []);
                }
            })
            .catch(err => console.error(err));

        return () => { cancelled = true; };
    }, [ section ]);

    if (! section) {
        notFound();
    }

    const active = genres.find(genre => genre.id === selected);

    return (
        <div className="p-4">
            <div className="flex items-center justify-between mb-5">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">{ section.title }</h2>
                    <p className="text-sm text-muted-foreground">
                        {active ? `${ active.name } ${ section.type === "tv" ? "series" : "movies" }, most popular first.` : section.description}
                    </p>
                </div>
            </div>

            {genres.length > 0 && (
                <ScrollArea className="mb-2">
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

            <Separator className="my-y" />

            {selected
                ? <MediaGrid type={section.type} category="popular" genre={String(selected)} />
                : <div className="grid grid-cols-1 gap-10 pt-5">
                    {section.rows.map(row => (
                        <MediaRow
                            key={`${ row.type }-${ row.category }`}
                            title={row.title}
                            type={row.type}
                            category={row.category}
                        />
                    ))}
                </div>}
        </div>
    );
}
