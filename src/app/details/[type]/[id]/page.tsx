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
import { Separator } from "@/components/ui/separator";
import { episodeKey, SeasonInfo, SeasonPicker } from "@/components/season-picker";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";

type MissingSeason = {
    seasonNumber: number;
    episodeNumbers: number[];
};

export default function Page() {
    let { type, id } = useParams();
    let [media, setMedia] = useState<Media>();
    let [seasons, setSeasons] = useState<SeasonInfo[]>([]);
    let [item, setItem] = useState<WatchlistItem>();
    // "<season>:<episode>" keys — the watchlist state, mirrored so a tick is instant
    let [monitored, setMonitored] = useState<Set<string>>(new Set());
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

    // the watchlist item carries the per episode monitored flags
    useEffect(() => {
        if (! entry) {
            setItem(undefined);
            return;
        }

        axios.get(`/api/watchlist/${ entry.id }`)
            .then(res => setItem(res.data.result))
            .catch(err => console.error(err));
    }, [ entry?.id, isDownloading ])

    // whatever the server says wins, every toggle answers with the whole item
    useEffect(() => {
        const next = new Set<string>();

        for (const season of item?.seasons || []) {
            for (const episode of season.episodes || []) {
                if (episode.monitored) {
                    next.add(episodeKey(season.seasonNumber, episode.episodeNumber));
                }
            }
        }

        setMonitored(next);
    }, [ item ])

    if (! media) {
        return <>loading</>;
    }

    const isTv = media.type === "tv";

    const selection = seasons
        .map(season => {
            const picked = season.episodes
                .filter(episode => monitored.has(episodeKey(season.season_number, episode.episode_number)))
                .map(episode => episode.episode_number);

            return {
                seasonNumber: season.season_number,
                // an empty list means the whole season on the api side
                episodeNumbers: picked.length === season.episodes.length ? [] : picked,
                count: picked.length
            };
        })
        .filter(season => season.count > 0);

    const pickedCount = selection.reduce((sum, season) => sum + season.count, 0);

    /**
     * The tick is the watchlist itself: it adds the show on the first episode and
     * removes it again when the last one is unticked.
     */
    const toggle = async (seasonNumber: number, episodeNumbers: number[] | null, checked: boolean) => {
        const affected = episodeNumbers
            || seasons.find(s => s.season_number === seasonNumber)?.episodes.map(e => e.episode_number)
            || [];

        setMonitored(prev => {
            const next = new Set(prev);

            for (const episodeNumber of affected) {
                const key = episodeKey(seasonNumber, episodeNumber);

                if (checked) {
                    next.add(key);
                } else {
                    next.delete(key);
                }
            }

            return next;
        });

        setSaving(true);

        try {
            const res = await axios.patch("/api/watchlist", {
                tmdbId,
                type,
                monitored: checked,
                seasonNumber,
                ...(episodeNumbers ? { episodes: episodeNumbers } : {})
            });

            setItem(res.data.result || undefined);

        } catch(err) {
            console.error(err);
            toast("Could not update the watchlist.");

        } finally {
            setSaving(false);
            refresh();
        }
    }

    const download = () => {
        setDownloading(true);
        setMissing(null);
        setMovieMissing(false);

        axios.post("/api/download", { type, id: tmdbId, seasons: selection })
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

        if (movieMissing) {
            await add(type as string, tmdbId, media.name);

        } else {
            // only the episodes that were actually missing, not their whole season
            for (const season of missing || []) {
                const res = await axios.patch("/api/watchlist", {
                    tmdbId,
                    type,
                    monitored: true,
                    seasonNumber: season.seasonNumber,
                    episodes: season.episodeNumbers
                });

                setItem(res.data.result || undefined);
            }

            refresh();
        }

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
                        disabled={isDownloading || (isTv && pickedCount === 0)}
                    >
                        <Loader2 className={classNames("animate-spin", { "hidden": !isDownloading })} />
                        <Download className={classNames({ "hidden": isDownloading })} />
                        Download
                        { isTv && pickedCount > 0 ? ` ${ pickedCount } episode${ pickedCount > 1 ? "s" : "" }` : "" }
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
                        Tick what you want — a whole season or single episodes. Ticking puts it on your
                        watchlist right away, unticking takes it off.
                    </p>

                    <Separator className="my-3" />

                    <SeasonPicker
                        seasons={seasons}
                        item={item}
                        monitored={monitored}
                        onToggle={toggle}
                        disabled={isSaving}
                    />
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
