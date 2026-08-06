'use client';

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { MediaCard } from "@/components/media-card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Media } from "@/types/media";

type Props = {
    title: string;
    description?: string;
    href?: string | null;
    items?: Media[];
};

export function MediaRow({ title, description, href, items }: Props) {
    // an empty row would be a header with nothing under it
    if (items && items.length === 0) {
        return null;
    }

    return (
        <div className="space-y-3">
            <div className="flex items-end justify-between gap-4">
                <div className="space-y-1">
                    <h3 className="text-lg font-semibold tracking-tight">{ title }</h3>
                    {description && <p className="text-sm text-muted-foreground">{ description }</p>}
                </div>

                {href && (
                    <Link href={href} className="flex shrink-0 items-center text-sm text-muted-foreground hover:text-foreground">
                        See more <ChevronRight className="size-4" />
                    </Link>
                )}
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
