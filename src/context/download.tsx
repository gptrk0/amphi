'use client';

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

import { EpisodePicker } from "@/components/episode-picker";
import { ReleasePicker } from "@/components/release-picker";
import { useWatchlist } from "@/context/watchlist";
import { DownloadPreview } from "@/types/download";
import { SeasonInfo } from "@/types/media";
import { WatchlistItem } from "@/types/watchlist";

export type SeasonSelection = {
    seasonNumber: number;
    // empty means the whole season
    episodeNumbers: number[];
};

export type DownloadTarget = {
    type: string;
    tmdbId: number;
    name: string;
    seasons?: SeasonSelection[];
};

type DownloadContextValue = {
    startDownload: (target: DownloadTarget) => void;
};

export const DownloadContext = createContext<DownloadContextValue>({
    startDownload: () => {}
});

export const useDownload = () => useContext(DownloadContext);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
    const { add, refresh } = useWatchlist();

    const [ target, setTarget ] = useState<DownloadTarget | null>(null);
    const [ preview, setPreview ] = useState<DownloadPreview | null>(null);
    const [ picks, setPicks ] = useState<Record<string, string>>({});
    const [ isLoading, setLoading ] = useState(false);
    const [ isStarting, setStarting ] = useState(false);

    // the step before the release search, for a show nobody has chosen episodes of
    const [ picking, setPicking ] = useState<DownloadTarget | null>(null);
    const [ seasons, setSeasons ] = useState<SeasonInfo[]>();
    const [ watched, setWatched ] = useState<WatchlistItem>();

    const search = useCallback(async (wanted: DownloadTarget) => {
        setLoading(true);
        setPreview(null);
        setPicks({});

        try {
            const res = await axios.post("/api/download/preview", {
                type: wanted.type,
                id: wanted.tmdbId,
                seasons: wanted.seasons || []
            });

            const result: DownloadPreview = res.data.result;

            setPreview(result);

            // the profile's own pick is the default, so confirming without touching
            // anything downloads exactly what the scanner would have taken
            setPicks(Object.fromEntries(result.choices
                .filter(choice => choice.options.length > 0)
                .map(choice => [ choice.key, choice.options[0].guid ])));

        } catch(err) {
            console.error(err);

            toast(axios.isAxiosError(err) && err.response?.data?.message || "Could not search the indexers.");
            setTarget(null);

        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * The episode list and whatever of it is already being watched, for the picker. Both
     * at once: the ticks it starts from are the watchlist's, and a show that is on nobody's
     * list simply answers null.
     */
    const loadEpisodes = useCallback(async (wanted: DownloadTarget) => {
        setSeasons(undefined);
        setWatched(undefined);

        try {
            const [ list, state ] = await Promise.all([
                axios.get("/api/seasons", { params: { id: wanted.tmdbId } }),
                axios.get("/api/watchlist", { params: { type: wanted.type, tmdbId: wanted.tmdbId } })
            ]);

            setSeasons(list.data.result || []);
            setWatched(state.data.result || undefined);

        } catch(err) {
            console.error(err);

            toast("Could not read the episode list.");
            setPicking(null);
        }
    }, []);

    /**
     * A film goes straight to the release search. A show with nothing chosen is asked
     * about first: pressing Download on one from a poster or the billboard used to send
     * no selection, which the api refused with "Pick at least one episode!" — a button
     * that was there and never worked.
     */
    const startDownload = useCallback((wanted: DownloadTarget) => {
        if (wanted.type === "tv" && ! wanted.seasons?.length) {
            setPicking(wanted);
            void loadEpisodes(wanted);

            return;
        }

        setTarget(wanted);
        void search(wanted);
    }, [ search, loadEpisodes ]);

    /** The picker answered: on to the same release dialog every download goes through. */
    const pickedEpisodes = useCallback((chosen: SeasonSelection[]) => {
        if (! picking) {
            return;
        }

        const wanted = { ...picking, seasons: chosen };

        setPicking(null);
        setTarget(wanted);
        void search(wanted);
    }, [ picking, search ]);

    /**
     * Only the parts that were not found: the whole film, or exactly the episodes
     * that are missing — not their entire season.
     */
    const watchTheRest = useCallback(async (current: DownloadPreview, wanted: DownloadTarget) => {
        if (wanted.type === "movie") {
            await add(wanted.type, wanted.tmdbId, wanted.name);

            return;
        }

        // when nothing was found at all there is no missing list to work from, and
        // then the whole request is what has to be waited for
        const seasons = current.missing.length > 0 ? current.missing : (wanted.seasons || []);

        for (const season of seasons) {
            await axios.patch("/api/watchlist", {
                tmdbId: wanted.tmdbId,
                type: wanted.type,
                monitored: true,
                seasonNumber: season.seasonNumber,
                // an empty list would match no episode at all, the season is meant
                ...(season.episodeNumbers.length > 0 ? { episodes: season.episodeNumbers } : {})
            });
        }

        toast(`${ wanted.name } is on your watchlist, the missing parts will follow.`);
    }, [ add ]);

    const confirm = useCallback(async (watchMissing: boolean) => {
        if (! target || ! preview) {
            return;
        }

        setStarting(true);

        try {
            if (preview.choices.length > 0) {
                const res = await axios.post("/api/download", { planId: preview.planId, picks });

                toast(res.data.message);
            }

            if (watchMissing) {
                await watchTheRest(preview, target);
            }

            setTarget(null);
            setPreview(null);

        } catch(err) {
            console.error(err);

            // the plan is only kept for a while, and searching again is the only
            // honest answer — the dialog stays open and refills itself
            if (axios.isAxiosError(err) && err.response?.status === 410) {
                toast("The search results expired, searching again...");

                void search(target);

            } else {
                toast(axios.isAxiosError(err) && err.response?.data?.message || "Could not start the download.");
            }

        } finally {
            setStarting(false);
            await refresh();
        }
    }, [ target, preview, picks, refresh, search, watchTheRest ]);

    // the dialog's own state lives here, so without this every keystroke of a search
    // in progress would re-render the page behind it
    const value = useMemo(() => ({ startDownload }), [ startDownload ]);

    return (
        <DownloadContext.Provider value={value}>
            { children }

            <EpisodePicker
                open={picking !== null}
                name={picking?.name || ""}
                seasons={seasons}
                item={watched}
                onCancel={() => setPicking(null)}
                onConfirm={pickedEpisodes}
            />

            <ReleasePicker
                open={target !== null}
                name={target?.name || ""}
                preview={preview}
                isLoading={isLoading}
                isStarting={isStarting}
                picks={picks}
                onPick={(key, guid) => setPicks(prev => ({ ...prev, [key]: guid }))}
                onCancel={() => { setTarget(null); setPreview(null); }}
                onConfirm={confirm}
            />
        </DownloadContext.Provider>
    );
}
