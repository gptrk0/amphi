'use client';

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { BookmarkX, Download } from "lucide-react";

import { Media } from "@/types/media";
import { WatchlistItem } from "@/types/watchlist";
import { useDownload } from "@/context/download";
import { useWatchlist } from "@/context/watchlist";
import { WatchlistBadge } from "@/components/watchlist-badge";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { episodeKey, SeasonInfo, SeasonPicker } from "@/components/season-picker";

export default function Page() {
    let { type, id } = useParams();
    let [media, setMedia] = useState<Media>();
    let [seasons, setSeasons] = useState<SeasonInfo[]>([]);
    let [item, setItem] = useState<WatchlistItem>();
    // "<season>:<episode>" keys — the watchlist state, mirrored so a tick is instant
    let [monitored, setMonitored] = useState<Set<string>>(new Set());
    let [isSaving, setSaving] = useState(false);

    const tmdbId = Number(id);
    const { getEntry, remove, refresh } = useWatchlist();
    const { startDownload } = useDownload();
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
        // the whole entry, not its id: a finished download replaces it and the
        // episode states below have to follow
    }, [ entry ])

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
        startDownload({
            type: type as string,
            tmdbId,
            name: media.name,
            seasons: selection.map(season => ({
                seasonNumber: season.seasonNumber,
                episodeNumbers: season.episodeNumbers
            }))
        });
    }

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
                        disabled={isTv && pickedCount === 0}
                    >
                        <Download />
                        Download
                        { isTv && pickedCount > 0 ? ` ${ pickedCount } episode${ pickedCount > 1 ? "s" : "" }` : "" }
                    </Button>

                    {entry?.monitored && <Button
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
    </>;
}
