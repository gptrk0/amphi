'use client';

import { useEffect, useState } from "react";
import axios from "axios";

import { MediaCard } from "@/components/media-card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Media } from "@/types/media";

type Props = {
    title: string;
    description?: string;
    type: string;
    category: string;
};

export function MediaRow({ title, description, type, category }: Props) {
    const [ items, setItems ] = useState<Media[]>();

    useEffect(() => {
        let cancelled = false;

        axios.get("/api/discover", { params: { type, category } })
            .then(res => {
                if (! cancelled) {
                    setItems(res.data.result || []);
                }
            })
            .catch(err => {
                console.error(err);

                if (! cancelled) {
                    setItems([]);
                }
            });

        return () => { cancelled = true; };
    }, [ type, category ]);

    // an empty row would be a header with nothing under it
    if (items && items.length === 0) {
        return null;
    }

    return (
        <div className="space-y-3">
            <div className="space-y-1">
                <h3 className="text-lg font-semibold tracking-tight">{ title }</h3>
                {description && <p className="text-sm text-muted-foreground">{ description }</p>}
            </div>

            <ScrollArea>
                <div className="flex space-x-4 pb-4">
                    {! items && Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-[3/4] w-[250px] shrink-0 rounded-md" />
                    ))}

                    {items?.map(item => (
                        <MediaCard
                            key={`${ item.type }-${ item.id }`}
                            media={item}
                            className="w-[250px] shrink-0"
                            aspectRatio="portrait"
                            width={250}
                            height={330}
                        />
                    ))}
                </div>

                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
}
