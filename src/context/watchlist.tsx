'use client';

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

import { WatchlistEntry } from "@/types/watchlist";

type WatchlistContextValue = {
    entries: WatchlistEntry[];
    isLoading: boolean;
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

    const getEntry = useCallback((type: string, tmdbId: number) => {
        return entries.find(v => v.type === type && v.tmdbId === tmdbId);
    }, [ entries ]);

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
                    episodeCount: item.episodeCount,
                    downloadedCount: item.downloadedCount,
                    monitored: item.monitored
                }
            ]);

            toast(res.data.message || `${ name || "Media" } added to your watchlist!`);

        } catch(err) {
            console.error(err);

            toast(`Could not add ${ name || "media" } to your watchlist.`);
        }
    }, []);

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
        }
    }, [ entries, refresh ]);

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
        }
    }, [ refresh ]);

    return (
        <WatchlistContext.Provider value={{ entries, isLoading, getEntry, add, remove, destroy, refresh }}>
            { children }
        </WatchlistContext.Provider>
    );
}
