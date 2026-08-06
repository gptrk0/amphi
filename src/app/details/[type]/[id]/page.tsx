'use client';

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { BookmarkX, Download, Loader2 } from "lucide-react";
import classNames from "classnames";

import { Media } from "@/types/media";
import { WatchlistItem } from "@/types/watchlist";
import { useWatchlist } from "@/context/watchlist";
import { WatchlistBadge } from "@/components/watchlist-badge";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";

type SeasonInfo = {
    season_number: number;
    name: string;
    air_date: string | null;
    episode_count: number;
};

type MissingSeason = {
    seasonNumber: number;
    episodeNumbers: number[];
};

export default function Page() {
    let { type, id } = useParams();
    let [media, setMedia] = useState<Media>();
    let [seasons, setSeasons] = useState<SeasonInfo[]>([]);
    let [item, setItem] = useState<WatchlistItem>();
    let [selected, setSelected] = useState<number[]>([]);
    let [isDownloading, setDownloading] = useState(false);
    let [isSaving, setSaving] = useState(false);
    let [missing, setMissing] = useState<MissingSeason[] | null>(null);
    let [movieMissing, setMovieMissing] = useState(false);

    const tmdbId = Number(id);
    const { getEntry, add, remove, refresh } = useWatchlist();
    const entry = getEntry(type as string, tmdbId);

    useEffect(() => {
        axios.get("/api/details", { params: { type, id } })
            .then(res => {
                setMedia(res.data.result);
                setSeasons(res.data.seasons || []);
            });
    }, [ type, id ])

    // the watchlist item carries the per season monitored flags
    useEffect(() => {
        if (! entry) {
            setItem(undefined);
            return;
        }

        axios.get(`/api/watchlist/${ entry.id }`)
            .then(res => setItem(res.data.result))
            .catch(err => console.error(err));
    }, [ entry?.id, isDownloading ])

    if (! media) {
        return <>loading</>;
    }

    const isTv = media.type === "tv";

    const toggleSeason = (seasonNumber: number, checked: boolean) => {
        setSelected(prev => checked
            ? [ ...prev, seasonNumber ]
            : prev.filter(v => v !== seasonNumber));
    }

    const download = () => {
        setDownloading(true);
        setMissing(null);
        setMovieMissing(false);

        axios.post("/api/download", { type, id: tmdbId, seasons: selected })
            .then(res => {
                if (res.data.message) {
                    toast(res.data.message);
                }

                if (res.data.missingMovie) {
                    setMovieMissing(true);
                } else if (res.data.missing?.length > 0) {
                    setMissing(res.data.missing);
                }

                refresh();
            })
            .catch(err => {
                console.error(err);
                toast(err.response?.data?.message || "Could not start the download.");
            })
            .finally(() => setDownloading(false));
    }

    const watchMissing = async () => {
        setSaving(true);

        const seasonNumbers = (missing || []).map(v => v.seasonNumber);

        await add(type as string, tmdbId, media.name, seasonNumbers.length > 0 ? seasonNumbers : undefined);

        setSaving(false);
        setMissing(null);
        setMovieMissing(false);
    }

    const missingSummary = (missing || []).map(season => {
        return `Season ${ season.seasonNumber }: episode${ season.episodeNumbers.length > 1 ? "s" : "" } ${ season.episodeNumbers.join(", ") }`;
    });

    return <>
        <div className="relative">
            <Image
                src={media.backdrop_img}
                alt={media.name}
                width={1920}
                height={1080}
                className="absolute inset-x-0 top-0 w-full opacity-75"
                style={{
                    maskImage: "linear-gradient(to bottom, rgba(0,0,0,1), rgba(0,0,0,0))"
                }}
            />

            {/* in normal flow so the page grows with the season list; backdrop stays behind */}
            <div className="relative w-full p-4">
                <div className="flex gap-5">
                    <Image
                        src={media.poster_img}
                        alt={media.name}
                        width={250}
                        height={330}
                        className="rounded-md"
                    />

                    <div className="flex flex-col justify-end">
                        <div className="flex items-center gap-2">
                            <Badge>{ media.type }</Badge>
                            <WatchlistBadge entry={entry} />
                        </div>
                        <h1 className="text-2xl font-medium">{ media.name }</h1>
                        <div>{ media.overview }</div>
                    </div>
                </div>

                <div className="flex gap-3 pt-10">
                    <Button
                        className="cursor-pointer"
                        onClick={download}
                        disabled={isDownloading || (isTv && selected.length === 0)}
                    >
                        <Loader2 className={classNames("animate-spin", { "hidden": !isDownloading })} />
                        <Download className={classNames({ "hidden": isDownloading })} />
                        Download
                        { isTv && selected.length > 0 ? ` ${ selected.length } season${ selected.length > 1 ? "s" : "" }` : "" }
                    </Button>

                    {entry && <Button
                        variant="outline"
                        className="cursor-pointer"
                        onClick={() => remove(type as string, tmdbId, media.name)}
                    >
                        <BookmarkX /> Stop watching
                    </Button>}
                </div>

                {isTv && <div className="pt-10 max-w-2xl">
                    <h2 className="text-lg font-medium">Seasons</h2>
                    <p className="text-sm text-muted-foreground">
                        Pick the seasons you want. Whatever is available starts downloading right away.
                    </p>

                    <Separator className="my-3" />

                    <div className="flex flex-col gap-1">
                        {seasons.map(season => {
                            const dbSeason = item?.seasons.find(s => s.seasonNumber === season.season_number);

                            return (
                                <label
                                    key={season.season_number}
                                    className="flex cursor-pointer items-center gap-3 py-1"
                                >
                                    <Checkbox
                                        className="cursor-pointer"
                                        checked={selected.includes(season.season_number)}
                                        onCheckedChange={(checked) => toggleSeason(season.season_number, checked === true)}
                                    />

                                    <span className="text-sm">
                                        <span className="font-medium">{ season.name }</span>
                                        <span className="text-muted-foreground">
                                            { " — " }{ season.episode_count } episodes
                                            { season.air_date ? ` (${ season.air_date.split("-")[0] })` : "" }
                                            { dbSeason && dbSeason.downloadedCount > 0
                                                ? ` — ${ dbSeason.downloadedCount }/${ dbSeason.episodeCount } downloaded`
                                                : "" }
                                            { dbSeason?.monitored ? " — watching" : "" }
                                        </span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>}
            </div>
        </div>

        <Dialog
            open={movieMissing || (missing !== null && missing.length > 0)}
            onOpenChange={(open) => { if (! open) { setMissing(null); setMovieMissing(false); } }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Not available yet</DialogTitle>
                    <DialogDescription>
                        { movieMissing
                            ? `${ media.name } is not on your indexers right now. Add it to your watchlist and it will be downloaded as soon as it shows up?`
                            : "These episodes are not available yet. Add them to your watchlist and they will be downloaded as soon as they show up?" }
                    </DialogDescription>
                </DialogHeader>

                {missingSummary.length > 0 && <div className="text-sm text-muted-foreground">
                    {missingSummary.map(line => <div key={line}>{ line }</div>)}
                </div>}

                <DialogFooter>
                    <Button
                        variant="outline"
                        className="cursor-pointer"
                        onClick={() => { setMissing(null); setMovieMissing(false); }}
                    >
                        No thanks
                    </Button>

                    <Button className="cursor-pointer" onClick={watchMissing} disabled={isSaving}>
                        <Loader2 className={classNames("animate-spin", { "hidden": !isSaving })} />
                        Add to watchlist
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </>;
}
