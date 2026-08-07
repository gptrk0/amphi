'use client';

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import axios from "axios";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, BookmarkX, ChevronsUpDown, Loader2, RefreshCw, Trash2 } from "lucide-react";
import classNames from "classnames";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WatchlistBadge } from "@/components/watchlist-badge";
import { useWatchlist } from "@/context/watchlist";
import { WatchlistItem, WatchStatus } from "@/types/watchlist";

type Props = {
    title: string;
    description: string;
    onlyStatus?: WatchStatus;
    emptyText: string;
};

type Column = {
    key: string;
    label: string;
    // what the column sorts on; a column without it cannot be sorted
    value?: (item: WatchlistItem) => string | number;
    render: (item: WatchlistItem) => ReactNode;
    className?: string;
};

const POLL_MS = 5000;

const STATUS_FILTERS: { label: string, value: WatchStatus | "ALL" }[] = [
    { label: "All", value: "ALL" },
    { label: "Watchlisted", value: "PENDING" },
    { label: "Searching", value: "SEARCHING" },
    { label: "Downloading", value: "DOWNLOADING" },
    { label: "Downloaded", value: "DOWNLOADED" }
];

const ago = (value: string | null) => {
    if (! value) {
        return "never";
    }

    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);

    if (minutes < 1) {
        return "just now";
    }

    if (minutes < 60) {
        return `${ minutes }m ago`;
    }

    const hours = Math.round(minutes / 60);

    return hours < 48 ? `${ hours }h ago` : `${ Math.round(hours / 24) }d ago`;
};

const speed = (bytesPerSecond: number) => {
    if (bytesPerSecond < 1024 * 1024) {
        return `${ Math.round(bytesPerSecond / 1024) } kB/s`;
    }

    return `${ (bytesPerSecond / (1024 * 1024)).toFixed(1) } MB/s`;
};

const remaining = (seconds: number | null) => {
    if (seconds === null) {
        return "";
    }

    return seconds < 3600 ? `${ Math.round(seconds / 60) }m left` : `${ Math.round(seconds / 3600) }h left`;
};

const progressText = (item: WatchlistItem) => {
    if (item.type === "tv") {
        return `${ item.downloadedCount }/${ item.episodeCount || "?" } episodes`;
    }

    return item.status === "DOWNLOADED" ? "complete" : "not yet";
};

export function WatchlistTable({ title, description, onlyStatus, emptyText }: Props) {
    const { entries, remove, destroy } = useWatchlist();
    const [ items, setItems ] = useState<WatchlistItem[]>();
    const [ status, setStatus ] = useState<WatchStatus | "ALL">("ALL");
    const [ sort, setSort ] = useState<{ key: string, direction: "asc" | "desc" }>({ key: "addedAt", direction: "desc" });
    const [ isScanning, setScanning ] = useState(false);
    const [ deleting, setDeleting ] = useState<WatchlistItem | null>(null);

    const load = () => {
        return axios.get("/api/watchlist", { params: { live: 1 } })
            .then(res => setItems(res.data.result || []))
            .catch(err => console.error(err));
    };

    /**
     * Unlike the scheduled round this one ignores the backoff and the release
     * dates — the point of pressing it is to ask right now, even for something
     * that is not out yet.
     */
    const scan = () => {
        setScanning(true);
        toast("Checking every watched item on your indexers...");

        axios.post("/api/scan", { force: true })
            .then(res => {
                toast(res.data.dryRun
                    ? `${ res.data.message } SCAN_DRY_RUN is on, so nothing was actually downloaded.`
                    : res.data.message);

                return load();
            })
            .catch(err => {
                console.error(err);
                toast(err.response?.data?.message || "Scan failed.");
            })
            .finally(() => setScanning(false));
    };

    // a change in the slim list (add/remove from anywhere) reloads the table
    useEffect(() => {
        load();
    }, [ entries.length ])

    // percentages only move while something is downloading, so the poll stops with it
    useEffect(() => {
        if (! items?.some(item => item.status === "DOWNLOADING")) {
            return;
        }

        const timer = setInterval(load, POLL_MS);

        return () => clearInterval(timer);
    }, [ items ])

    const poster = (item: WatchlistItem) => {
        if (! item.media?.poster_img) {
            return <div className="flex h-[48px] w-[32px] shrink-0 items-center justify-center rounded-sm border text-[8px] text-muted-foreground">no<br />img</div>;
        }

        return <Image src={item.media.poster_img} alt="" width={32} height={48} className="shrink-0 rounded-sm" />;
    };

    const columns: Column[] = [
        {
            key: "name",
            label: "Title",
            value: item => item.media?.name?.toLowerCase() || String(item.tmdbId),
            render: item => (
                <div className="flex items-center gap-3">
                    { poster(item) }

                    <Link href={`/details/${ item.type }/${ item.tmdbId }`} className="font-medium hover:underline">
                        { item.media?.name || `TMDB #${ item.tmdbId }` }
                    </Link>
                </div>
            )
        },
        {
            key: "type",
            label: "Type",
            value: item => item.type,
            render: item => <span className="text-muted-foreground">{ item.type === "tv" ? "Series" : "Movie" }</span>
        },
        ...(onlyStatus ? [] : [ {
            key: "status",
            label: "Status",
            value: (item: WatchlistItem) => item.status,
            render: (item: WatchlistItem) => <WatchlistBadge entry={item} />
        } ]),
        {
            key: "progress",
            label: "Progress",
            value: item => item.download?.progress ?? (item.episodeCount > 0 ? item.downloadedCount / item.episodeCount : 0),
            render: item => (
                <div>
                    <div>{ progressText(item) }</div>

                    {item.download && <div className="text-xs text-muted-foreground">
                        { Math.round(item.download.progress * 100) }% · { speed(item.download.downloadSpeed) }
                        { item.download.eta !== null ? ` · ${ remaining(item.download.eta) }` : "" }
                    </div>}
                </div>
            )
        },
        {
            key: "addedAt",
            label: "Added",
            value: item => item.addedAt,
            render: item => <span className="text-muted-foreground">{ ago(item.addedAt) }</span>
        },
        ...(onlyStatus ? [] : [ {
            key: "lastCheckedAt",
            label: "Last checked",
            value: (item: WatchlistItem) => item.lastCheckedAt || "",
            render: (item: WatchlistItem) => <span className="text-muted-foreground">{ ago(item.lastCheckedAt) }</span>
        }, {
            key: "searchAttempts",
            label: "Attempts",
            value: (item: WatchlistItem) => item.searchAttempts,
            render: (item: WatchlistItem) => <span className="text-muted-foreground">{ item.searchAttempts || "—" }</span>
        } ]),
        {
            key: "actions",
            label: "",
            className: "text-right",
            render: item => (onlyStatus
                ? <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer"
                    title="Delete — removes the torrent as well"
                    onClick={() => setDeleting(item)}
                >
                    <Trash2 />
                </Button>
                : <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer"
                    title="Stop watching — keeps whatever is already downloaded"
                    onClick={() => remove(item.type, item.tmdbId, item.media?.name || `TMDB #${ item.tmdbId }`)}
                >
                    <BookmarkX />
                </Button>)
        }
    ];

    const toggleSort = (key: string) => {
        setSort(prev => prev.key === key
            ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
            : { key, direction: "asc" });
    };

    const visible = (items || [])
        .filter(item => ! onlyStatus || item.status === onlyStatus)
        // something downloaded that is no longer watched belongs under Downloaded
        // only — it is not waiting for anything any more
        .filter(item => onlyStatus || item.monitored || item.status !== "DOWNLOADED")
        .filter(item => status === "ALL" || item.status === status);

    const column = columns.find(v => v.key === sort.key);

    const sorted = column?.value
        ? [ ...visible ].sort((a, b) => {
            const left = column.value!(a);
            const right = column.value!(b);
            const order = left < right ? -1 : left > right ? 1 : 0;

            return sort.direction === "asc" ? order : -order;
        })
        : visible;

    return (
        <div className="p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">{ title }</h2>
                    <p className="text-sm text-muted-foreground">{ description }</p>
                </div>

                {! onlyStatus && <Button
                    className="shrink-0 cursor-pointer"
                    onClick={scan}
                    disabled={isScanning}
                    title="Check every watched item now, even the ones that are not out yet"
                >
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isScanning })} />
                    <RefreshCw className={classNames({ "hidden": isScanning })} />
                    Scan now
                </Button>}
            </div>

            <Separator className="my-5" />

            {! onlyStatus && <div className="flex flex-wrap gap-2 pb-4">
                {STATUS_FILTERS.map(filter => (
                    <Button
                        key={filter.value}
                        size="sm"
                        variant={status === filter.value ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => setStatus(filter.value)}
                    >
                        { filter.label }
                    </Button>
                ))}
            </div>}

            {! items && <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>}

            {items && sorted.length === 0 && <p className="text-sm text-muted-foreground">{ emptyText }</p>}

            {items && sorted.length > 0 && <Table>
                <TableHeader>
                    <TableRow>
                        {columns.map(col => (
                            <TableHead key={col.key} className={col.className}>
                                {col.value
                                    ? <button
                                        type="button"
                                        className="flex cursor-pointer items-center gap-1 hover:text-foreground"
                                        onClick={() => toggleSort(col.key)}
                                    >
                                        { col.label }

                                        {sort.key !== col.key && <ChevronsUpDown className="size-3 text-muted-foreground" />}
                                        {sort.key === col.key && sort.direction === "asc" && <ArrowUp className="size-3" />}
                                        {sort.key === col.key && sort.direction === "desc" && <ArrowDown className="size-3" />}
                                    </button>
                                    : col.label}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>

                <TableBody>
                    {sorted.map(item => (
                        <TableRow key={item.id}>
                            {columns.map(col => (
                                <TableCell key={col.key} className={classNames(col.className, { "py-1": true })}>
                                    { col.render(item) }
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>}

            <Dialog open={deleting !== null} onOpenChange={(open) => { if (! open) { setDeleting(null); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete { deleting?.media?.name || "this item" }?</DialogTitle>
                        <DialogDescription>
                            The torrent is removed from qBittorrent either way, and it will not be
                            downloaded again. Do you want to keep the files on disk?
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setDeleting(null)}>
                            Cancel
                        </Button>

                        <Button
                            variant="outline"
                            className="cursor-pointer"
                            onClick={() => {
                                destroy(deleting!.id, false, deleting!.media?.name);
                                setDeleting(null);
                            }}
                        >
                            Keep the files
                        </Button>

                        <Button
                            variant="destructive"
                            className="cursor-pointer"
                            onClick={() => {
                                destroy(deleting!.id, true, deleting!.media?.name);
                                setDeleting(null);
                            }}
                        >
                            <Trash2 /> Delete the files too
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
