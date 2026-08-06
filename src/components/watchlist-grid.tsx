'use client';

import { useEffect, useState } from "react";
import axios from "axios";

import { MediaCard } from "@/components/media-card";
import { WatchlistBadge } from "@/components/watchlist-badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchlist } from "@/context/watchlist";
import { WatchlistItem, WatchStatus } from "@/types/watchlist";

type Props = {
    title: string;
    description: string;
    onlyStatus?: WatchStatus;
    emptyText: string;
};

export function WatchlistGrid({ title, description, onlyStatus, emptyText }: Props) {
    const { entries } = useWatchlist();
    const [ items, setItems ] = useState<WatchlistItem[]>();

    // a change in the slim list (add/remove from anywhere) reloads the enriched list
    useEffect(() => {
        axios.get("/api/watchlist")
            .then(res => setItems(res.data.result || []))
            .catch(err => console.error(err));
    }, [ entries.length ])

    const visible = (items || []).filter(v => !onlyStatus || v.status === onlyStatus);

    return (
        <div className="p-4">
            <div className="flex items-center justify-between mb-5">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">{ title }</h2>
                    <p className="text-sm text-muted-foreground">{ description }</p>
                </div>
            </div>

            <Separator className="my-y" />

            {! items && <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 pt-5">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-[3/4] w-full rounded-md" />
                ))}
            </div>}

            {items && visible.length === 0 && (
                <p className="pt-5 text-sm text-muted-foreground">{ emptyText }</p>
            )}

            {items && visible.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 pt-5">
                    {visible.map(item => (
                        item.media
                            ? <MediaCard
                                key={item.id}
                                media={item.media}
                                aspectRatio="portrait"
                                width={250}
                                height={330}
                            />
                            : <div key={item.id} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-md border p-3 text-center text-xs text-muted-foreground">
                                <span>TMDB #{ item.tmdbId } ({ item.type })</span>
                                <span>metadata is currently unavailable</span>
                                <WatchlistBadge entry={item} />
                            </div>
                    ))}
                </div>
            )}
        </div>
    );
}
