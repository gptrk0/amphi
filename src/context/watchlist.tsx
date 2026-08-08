'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

import { WatchlistEntry } from "@/types/watchlist";

type WatchlistContextValue = {
    entries: WatchlistEntry[];
    isLoading: boolean;
    // bumped by each of the actions below, so a view can reload on a real change
    // instead of guessing one from the list itself
    revision: number;
    getEntry: (type: string, tmdbId: number) => WatchlistEntry | undefined;
    add: (type: string, tmdbId: number, name?: string, seasons?: number[]) => Promise<void>;
    remove: (type: string, tmdbId: number, name?: string) => Promise<void>;
    destroy: (id: number, deleteFiles: boolean, name?: string) => Promise<void>;
    refresh: () => Promise<void>;
};

const noop = async () => {};

export const WatchlistContext = createContext<WatchlistContextValue>({
    entries: [],
    isLoading: false,
    revision: 0,
    getEntry: () => undefined,
    add: noop,
    remove: noop,
    destroy: noop,
    refresh: noop
});

export const useWatchlist = () => useContext(WatchlistContext);

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
    const [ entries, setEntries ] = useState<WatchlistEntry[]>([]);
    const [ isLoading, setLoading ] = useState(true);
    const [ revision, setRevision ] = useState(0);

    const touch = useCallback(() => setRevision(prev => prev + 1), []);

    const refresh = useCallback(async () => {
        try {
            const res = await axios.get("/api/watchlist", { params: { slim: 1 } });

            setEntries(res.data.result || []);

        } catch(err) {
            console.error(err);

        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [ refresh ])

    // a grid holds well over a hundred cards, each asking for its own entry
    const byKey = useMemo(() => {
        return new Map(entries.map(entry => [ `${ entry.type }:${ entry.tmdbId }`, entry ]));
    }, [ entries ]);

    const getEntry = useCallback((type: string, tmdbId: number) => {
        return byKey.get(`${ type }:${ tmdbId }`);
    }, [ byKey ]);

    const add = useCallback(async (type: string, tmdbId: number, name?: string, seasons?: number[]) => {
        try {
            const res = await axios.post("/api/watchlist", { tmdbId, type, seasons });
            const item = res.data.result;

            setEntries(prev => [
                ...prev.filter(v => !(v.type === type && v.tmdbId === tmdbId)),
                {
                    id: item.id,
                    tmdbId: item.tmdbId,
                    type: item.type,
                    status: item.status,
                    nextAirDate: item.nextAirDate,
                    episodeCount: item.episodeCount,
                    downloadedCount: item.downloadedCount,
                    monitored: item.monitored
                }
            ]);

            toast(res.data.message || `${ name || "Media" } added to your watchlist!`);
            touch();

        } catch(err) {
            console.error(err);

            toast(`Could not add ${ name || "media" } to your watchlist.`);
        }
    }, [ touch ]);

    /**
     * Stop watching, which is not the same as deleting: anything already downloaded
     * keeps its row and stays listed under Downloaded, so the entry may survive.
     */
    const remove = useCallback(async (type: string, tmdbId: number, name?: string) => {
        const entry = entries.find(v => v.type === type && v.tmdbId === tmdbId);

        if (! entry) {
            return;
        }

        setEntries(prev => prev.map(v => v.id === entry.id ? { ...v, monitored: false } : v));

        try {
            await axios.delete(`/api/watchlist/${ entry.id }`);

            toast(`${ name || "Media" } is no longer watched.`);

        } catch(err) {
            console.error(err);

            toast(`Could not stop watching ${ name || "media" }.`);

        } finally {
            await refresh();
            touch();
        }
    }, [ entries, refresh, touch ]);

    /**
     * Delete for good: the torrent goes from the client too, and with `deleteFiles`
     * so do the files.
     */
    const destroy = useCallback(async (id: number, deleteFiles: boolean, name?: string) => {
        setEntries(prev => prev.filter(v => v.id !== id));

        try {
            await axios.delete(`/api/watchlist/${ id }`, { params: { torrent: 1, files: deleteFiles ? 1 : 0 } });

            toast(deleteFiles
                ? `${ name || "Media" } and its files were deleted.`
                : `${ name || "Media" } was removed, the files were kept.`);

        } catch(err) {
            console.error(err);

            toast(`Could not delete ${ name || "media" }.`);

        } finally {
            await refresh();
            touch();
        }
    }, [ refresh, touch ]);

    // a fresh object here would re-render every consumer on every render of this
    // provider, and a media grid is over a hundred of them
    const value = useMemo(
        () => ({ entries, isLoading, revision, getEntry, add, remove, destroy, refresh }),
        [ entries, isLoading, revision, getEntry, add, remove, destroy, refresh ]
    );

    return (
        <WatchlistContext.Provider value={value}>
            { children }
        </WatchlistContext.Provider>
    );
}
