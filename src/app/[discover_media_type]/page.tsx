'use client';

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import axios from "axios";

import { MediaCard } from "@/components/media-card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Media } from "@/types/media";

export default function Page() {
    const { discover_media_type } = useParams();
    const [ medias, setMedias ] = useState<Media[][]>();

    useEffect(() => {
        let type = 'all';

        if (discover_media_type === 'movies') {
            type = 'movie';
        } else if (discover_media_type === 'series') {
            type = 'tv';
        }

        axios.get("/api/discover", {
            params: {
                type: type,
                time_window: 'day'
            }
        })
        .then(res => {
            setMedias(res.data.result);
        });
    }, [])

    return (
        <div className="p-4">
            {medias && <>
                <div className="flex items-center justify-between mb-5">
                    <div className="space-y-1">
                        <h2 className="text-2xl font-semibold tracking-tight">
                            Trending
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Top picks for you.
                        </p>
                    </div>
                </div>

                <Separator className="my-y" />
                
                <div className="grid grid-cols-1 gap-10">
                    {medias.map((row, i) => (
                        <ScrollArea key={i}>
                            <div className="flex space-x-4 pb-4">
                                {row.map(item => (
                                    <MediaCard
                                        key={item.id}
                                        media={item}
                                        className="w-[250px]"
                                        aspectRatio="portrait"
                                        width={250}
                                        height={330}
                                    />
                                ))}
                            </div>
                            <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                    ))}
                </div>
            </>}
        </div>
    );
}
