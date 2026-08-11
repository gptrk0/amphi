'use client';

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { episodeKey, SeasonPicker } from "@/components/season-picker";
import { SeasonSelection } from "@/context/download";
import { useLocale } from "@/context/locale";
import { SeasonInfo } from "@/types/media";
import { WatchlistItem } from "@/types/watchlist";

/**
 * "Which episodes?", asked before the release search.
 *
 * A film is one thing to download and needs no question. A show is not, and pressing
 * Download on one from a poster, a row or the billboard used to send no selection at
 * all — the api answered "Pick at least one episode!" and the button read as broken.
 * The only place that could answer the question was the details page, because it is
 * server rendered and has the episode list; this asks it anywhere, with the same ticks.
 *
 * **The ticks here are not the watchlist.** On the details page a tick *is* the watchlist
 * and writes through on the spot. Here it is a selection for one download and nothing
 * else, so nothing is saved by opening this and changing your mind. What it does start
 * from is the watchlist: whatever is already being watched arrives ticked, because that
 * is almost always the answer to "what do you want".
 */

type Props = {
    open: boolean;
    name: string;
    // undefined while the episode list is still being read
    seasons: SeasonInfo[] | undefined;
    // the per episode state, for the "downloaded" and "waiting" notes
    item?: WatchlistItem;
    onCancel: () => void;
    onConfirm: (seasons: SeasonSelection[]) => void;
};

const watchedKeys = (item?: WatchlistItem) => {
    const keys = new Set<string>();

    for (const season of item?.seasons || []) {
        for (const episode of season.episodes || []) {
            if (episode.monitored) {
                keys.add(episodeKey(season.seasonNumber, episode.episodeNumber));
            }
        }
    }

    return keys;
};

export function EpisodePicker({ open, name, seasons, item, onCancel, onConfirm }: Props) {
    const { t } = useLocale();
    const [ picked, setPicked ] = useState<Set<string>>(new Set());

    // the watchlist is the starting point, and it arrives after the dialog does
    useEffect(() => {
        setPicked(watchedKeys(item));
    }, [ item, open ]);

    const toggle = (seasonNumber: number, episodeNumbers: number[] | null, checked: boolean) => {
        const affected = episodeNumbers
            || seasons?.find(season => season.season_number === seasonNumber)?.episodes.map(episode => episode.episode_number)
            || [];

        setPicked(prev => {
            const next = new Set(prev);

            for (const episodeNumber of affected) {
                if (checked) {
                    next.add(episodeKey(seasonNumber, episodeNumber));
                } else {
                    next.delete(episodeKey(seasonNumber, episodeNumber));
                }
            }

            return next;
        });
    };

    // the same shape the details page sends: an empty episode list means the whole
    // season, which is what lets the grab decide a season pack is the better answer
    const selection = (seasons || [])
        .map(season => {
            const chosen = season.episodes
                .filter(episode => picked.has(episodeKey(season.season_number, episode.episode_number)))
                .map(episode => episode.episode_number);

            return {
                seasonNumber: season.season_number,
                episodeNumbers: chosen.length === season.episodes.length ? [] : chosen,
                count: chosen.length
            };
        })
        .filter(season => season.count > 0);

    const count = selection.reduce((sum, season) => sum + season.count, 0);

    return (
        <Dialog open={open} onOpenChange={(next) => { if (! next) { onCancel(); } }}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{ t("download.episodes.title", { name }) }</DialogTitle>

                    <DialogDescription>{ t("download.episodes.description") }</DialogDescription>
                </DialogHeader>

                {! seasons && <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>}

                {seasons && seasons.length === 0 && (
                    <p className="text-muted-foreground text-sm">{ t("download.episodes.empty") }</p>
                )}

                {seasons && seasons.length > 0 && (
                    <SeasonPicker
                        seasons={seasons}
                        item={item}
                        monitored={picked}
                        onToggle={toggle}
                    />
                )}

                <DialogFooter>
                    <Button variant="outline" className="cursor-pointer" onClick={onCancel}>
                        { t("common.cancel") }
                    </Button>

                    <Button
                        className="cursor-pointer"
                        disabled={count === 0}
                        onClick={() => onConfirm(selection.map(season => ({
                            seasonNumber: season.seasonNumber,
                            episodeNumbers: season.episodeNumbers
                        })))}
                    >
                        <Download />
                        { count === 0
                            ? t("download.episodes.pick")
                            : t(count === 1 ? "download.episodes.searchOne" : "download.episodes.search", { n: count }) }
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
