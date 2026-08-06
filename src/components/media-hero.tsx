'use client';

import Image from "next/image";
import Link from "next/link";
import { Bookmark, BookmarkX, Download, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWatchlist } from "@/context/watchlist";
import { useDownload } from "@/hooks/use-download";
import { Media } from "@/types/media";

export function MediaHero({ media }: { media: Media }) {
    const { getEntry, add, remove } = useWatchlist();
    const download = useDownload();
    const entry = getEntry(media.type, media.id);
    const details = `/details/${ media.type }/${ media.id }`;

    return (
        <div className="relative mb-10 overflow-hidden rounded-lg border">
            <Image
                src={media.backdrop_img}
                alt={media.name}
                width={1280}
                height={720}
                priority
                className="h-[300px] w-full object-cover object-top md:h-[420px]"
            />

            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />

            <div className="absolute inset-x-0 bottom-0 space-y-3 p-6 md:max-w-2xl md:p-8">
                <div className="flex items-center gap-2">
                    <Badge>{ media.type }</Badge>
                    {media.date && <span className="text-sm text-muted-foreground">{ media.date.split("-")[0] }</span>}
                </div>

                <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{ media.name }</h2>

                <p className="line-clamp-3 text-sm text-muted-foreground">{ media.overview }</p>

                <div className="flex flex-wrap gap-2 pt-1">
                    {/* series need their seasons picked first, so they go to the detail page */}
                    {media.type === "movie"
                        ? <Button onClick={() => download(media)}>
                            <Download /> Download
                        </Button>
                        : <Button asChild>
                            <Link href={details}><Download /> Download</Link>
                        </Button>}

                    {entry
                        ? <Button variant="secondary" onClick={() => remove(media.type, media.id, media.name)}>
                            <BookmarkX /> Remove
                        </Button>
                        : <Button variant="secondary" onClick={() => add(media.type, media.id, media.name)}>
                            <Bookmark /> Watchlist
                        </Button>}

                    <Button variant="ghost" asChild>
                        <Link href={details}><Info /> Details</Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
