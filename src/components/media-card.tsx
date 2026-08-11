'use client';

import Image from "next/image"
import { Bookmark, BookmarkCheck, BookmarkX, Download } from "lucide-react"

import { cn } from "@/lib/utils"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"

import { Badge } from "./ui/badge"
import { WatchlistBadge } from "./watchlist-badge"
import { useWatchlist } from "@/context/watchlist"
import { useDownload } from "@/context/download"
import { useLocale } from "@/context/locale"
import { Media } from "@/types/media"
import Link from "next/link"

interface Props extends React.HTMLAttributes<HTMLDivElement> {
    media: Media;
    aspectRatio?: "portrait" | "square";
    width?: number;
    height?: number;
}

export function MediaCard({
    media,
    aspectRatio = "portrait",
    width,
    height,
    className,
    ...props
}: Props) {
    const { getEntry, add, remove } = useWatchlist();
    const { startDownload } = useDownload();
    const { t } = useLocale();
    const entry = getEntry(media.type, media.id);

    return (
        <div className={cn("space-y-3", className)} {...props}>
            <ContextMenu>
                <ContextMenuTrigger>
                    <Link href={`/details/${ media.type }/${ media.id }`}>
                        <div className="relative overflow-hidden rounded-md cursor-pointer">
                            {media.poster_img
                                ? <Image
                                    src={media.poster_img}
                                    alt={media.name}
                                    width={width}
                                    height={height}
                                    // w-full, not w-auto: with `auto` the image keeps the
                                    // intrinsic width it was asked for and refuses to shrink,
                                    // which makes a grid of cards wider than the page
                                    className={cn(
                                        "h-auto w-full object-cover transition-all hover:scale-105",
                                        aspectRatio === "portrait" ? "aspect-[3/4]" : "aspect-square"
                                    )}
                                />
                                : <div className={cn(
                                    "flex w-full items-center justify-center bg-muted p-3 text-center text-xs text-muted-foreground",
                                    aspectRatio === "portrait" ? "aspect-[3/4]" : "aspect-square"
                                )}>
                                    no poster
                                </div>}

                            <Badge className="absolute left-2 top-2">{ media.type }</Badge>

                            {entry?.monitored && <BookmarkCheck className="absolute right-2 top-2 size-5 drop-shadow-md" />}
                        </div>
                    </Link>
                </ContextMenuTrigger>

                <ContextMenuContent className="w-56">
                    {entry?.monitored
                        ? <ContextMenuItem className="cursor-pointer" onClick={() => remove(media.type, media.id, media.name)}>
                            <BookmarkX /> { t("discover.card.stopWatching") }
                        </ContextMenuItem>
                        : <ContextMenuItem className="cursor-pointer" onClick={() => add(media.type, media.id, media.name)}>
                            <Bookmark /> { t("discover.card.addToWatchlist") }
                        </ContextMenuItem>}

                    {media.type === "movie" && <>
                        <ContextMenuSeparator />

                        <ContextMenuItem
                            className="cursor-pointer"
                            onClick={() => startDownload({ type: media.type, tmdbId: media.id, name: media.name })}
                        >
                            <Download /> { t("discover.card.downloadNow") }
                        </ContextMenuItem>
                    </>}
                </ContextMenuContent>
            </ContextMenu>

            <div className="pt-2 space-y-1 text-sm">
                <h3 className="font-medium leading-none">{media.name}</h3>

                <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">{media.date?.split("-")[0]}</p>
                    <WatchlistBadge entry={entry} />
                </div>
            </div>
        </div>
    )
}
