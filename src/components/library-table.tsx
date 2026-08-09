'use client';

import { ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import axios from "axios";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronsUpDown, Clock, Trash2, Undo2 } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
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
import { useWatchlist } from "@/context/watchlist";
import { LibraryItem } from "@/types/library";

type Column = {
    key: string;
    label: string;
    value?: (item: LibraryItem) => string | number;
    render: (item: LibraryItem) => ReactNode;
    className?: string;
};

const POLL_MS = 5000;

const FILTERS: { label: string, value: "ALL" | "DOWNLOADING" | "AVAILABLE" }[] = [
    { label: "All", value: "ALL" },
    { label: "Downloading", value: "DOWNLOADING" },
    { label: "Ready to watch", value: "AVAILABLE" }
];

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

const ago = (value: string | null) => {
    if (! value) {
        return "—";
    }

    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);

    if (minutes < 60) {
        return `${ Math.max(minutes, 1) }m ago`;
    }

    const hours = Math.round(minutes / 60);

    return hours < 48 ? `${ hours }h ago` : `${ Math.round(hours / 24) }d ago`;
};

/** How much of the seed time is left, which is the only thing blocking a delete. */
const seedText = (value: string | null) => {
    if (! value) {
        return "";
    }

    const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3600000);

    if (hours <= 0) {
        return "";
    }

    return hours < 48 ? `${ hours }h left` : `${ Math.ceil(hours / 24) } days left`;
};

/**
 * What is on disk or on its way there — one row per torrent, because seeding and
 * deleting are what a torrent does, not what a title does.
 */
export function LibraryTable() {
    const { refresh } = useWatchlist();
    const [ items, setItems ] = useState<LibraryItem[]>();
    const [ filter, setFilter ] = useState<"ALL" | "DOWNLOADING" | "AVAILABLE">("ALL");
    const [ sort, setSort ] = useState<{ key: string, direction: "asc" | "desc" }>({ key: "startedAt", direction: "desc" });
    const [ deleting, setDeleting ] = useState<LibraryItem | null>(null);
    const request = useRef(0);

    const load = () => {
        const ticket = ++request.current;

        return axios.get("/api/library", { params: { live: 1 } })
            .then(res => {
                if (ticket === request.current) {
                    setItems(res.data.result || []);
                }
            })
            .catch(err => console.error(err));
    };

    useEffect(() => {
        load();
    }, [])

    // percentages only move while something is downloading, so the poll stops with it
    useEffect(() => {
        if (! items?.some(item => item.status === "DOWNLOADING")) {
            return;
        }

        const timer = setInterval(load, POLL_MS);

        return () => clearInterval(timer);
    }, [ items ])

    const name = (item: LibraryItem) => item.media?.name || `TMDB #${ item.tmdbId }`;

    const mark = async (item: LibraryItem, deleteRequested: boolean, deleteFiles = true) => {
        setDeleting(null);

        try {
            await axios.patch(`/api/library/${ item.id }`, { deleteRequested, deleteFiles });

            toast(deleteRequested
                ? `${ name(item) } will be deleted when its seed time is up.`
                : `${ name(item) } is staying.`);

        } catch(err) {
            console.error(err);
            toast(`Could not update ${ name(item) }.`);

        } finally {
            await load();
        }
    };

    const destroy = async (item: LibraryItem, deleteFiles: boolean) => {
        setDeleting(null);

        try {
            await axios.delete(`/api/library/${ item.id }`, { params: { files: deleteFiles ? 1 : 0 } });

            toast(deleteFiles
                ? `${ name(item) } and its files were deleted.`
                : `${ name(item) } was removed, the files were kept.`);

        } catch(err) {
            console.error(err);
            toast(`Could not delete ${ name(item) }.`);

        } finally {
            await load();
            await refresh();
        }
    };

    const poster = (item: LibraryItem) => {
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

                    <div className="min-w-0">
                        <Link href={`/details/${ item.type }/${ item.tmdbId }`} className="font-medium hover:underline">
                            { name(item) }
                        </Link>

                        {item.covers && <div className="text-xs text-muted-foreground">{ item.covers }</div>}
                    </div>
                </div>
            )
        },
        {
            key: "release",
            label: "Release",
            value: item => item.releaseTitle.toLowerCase(),
            render: item => (
                <span className="block max-w-[22rem] truncate text-xs text-muted-foreground" title={item.releaseTitle}>
                    { item.releaseTitle || "—" }
                </span>
            )
        },
        {
            key: "status",
            label: "Status",
            value: item => item.status,
            render: item => (
                <div className="min-w-[8rem]">
                    {item.status === "AVAILABLE"
                        ? <Badge>Ready to watch</Badge>
                        : <Badge variant="secondary">Downloading</Badge>}

                    {item.download && item.status === "DOWNLOADING" && <>
                        <div className="my-1 h-1 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full bg-primary transition-[width]"
                                style={{ width: `${ Math.round(item.download.progress * 100) }%` }}
                            />
                        </div>

                        <div className="text-xs text-muted-foreground">
                            { [
                                `${ Math.round(item.download.progress * 100) }%`,
                                speed(item.download.downloadSpeed),
                                remaining(item.download.eta)
                            ].filter(Boolean).join(" · ") }
                        </div>
                    </>}

                    {item.status === "DOWNLOADING" && ! item.download && (
                        <div className="text-xs text-muted-foreground">not in the client</div>
                    )}
                </div>
            )
        },
        {
            key: "seed",
            label: "Seeding",
            value: item => item.seedUntil || "",
            render: item => {
                if (item.status !== "AVAILABLE") {
                    return <span className="text-muted-foreground">—</span>;
                }

                const left = seedText(item.seedUntil);

                return (
                    <div className="min-w-[7rem]">
                        <div className={classNames("flex items-center gap-1", { "text-muted-foreground": ! left })}>
                            {left && <Clock className="size-3" />}
                            { left || "free to delete" }
                        </div>

                        {item.deleteRequested && (
                            <div className="text-xs text-destructive">
                                { left ? "goes when the time is up" : "deleting..." }
                            </div>
                        )}
                    </div>
                );
            }
        },
        {
            key: "startedAt",
            label: "Added",
            value: item => item.startedAt,
            render: item => <span className="text-muted-foreground">{ ago(item.startedAt) }</span>
        },
        {
            key: "actions",
            label: "",
            className: "text-right",
            render: item => (item.deleteRequested
                ? <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer"
                    title="Keep it after all"
                    onClick={() => mark(item, false)}
                >
                    <Undo2 />
                </Button>
                : <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer"
                    title={item.seeding ? "Still seeding — mark it for deletion" : "Delete"}
                    onClick={() => setDeleting(item)}
                >
                    <Trash2 />
                </Button>)
        }
    ];

    const toggleSort = (key: string) => {
        setSort(prev => prev.key === key
            ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
            : { key, direction: "asc" });
    };

    const visible = (items || []).filter(item => filter === "ALL" || item.status === filter);
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
            <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">Library</h2>
                <p className="text-sm text-muted-foreground">
                    Everything you have and everything on its way. A finished download seeds for a while before it can be deleted.
                </p>
            </div>

            <Separator className="my-5" />

            <div className="flex flex-wrap gap-2 pb-4">
                {FILTERS.map(option => (
                    <Button
                        key={option.value}
                        size="sm"
                        variant={filter === option.value ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => setFilter(option.value)}
                    >
                        { option.label }
                    </Button>
                ))}
            </div>

            {! items && <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>}

            {items && sorted.length === 0 && <p className="text-sm text-muted-foreground">
                Nothing here yet — whatever the app downloads shows up in this list.
            </p>}

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
                                <TableCell key={col.key} className={classNames(col.className, "py-1")}>
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
                        <DialogTitle>
                            { deleting?.seeding ? "Mark for deletion" : "Delete" } { deleting ? name(deleting) : "this" }?
                        </DialogTitle>

                        <DialogDescription>
                            {deleting?.seeding
                                ? `This is still seeding for another ${ seedText(deleting.seedUntil) }. It stays until then and goes by itself the moment the time is up.`
                                : "The torrent is removed from qBittorrent either way, and it will not be downloaded again. Do you want to keep the files on disk?"}
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setDeleting(null)}>
                            Cancel
                        </Button>

                        <Button
                            variant="outline"
                            className="cursor-pointer"
                            onClick={() => deleting?.seeding ? mark(deleting, true, false) : destroy(deleting!, false)}
                        >
                            Keep the files
                        </Button>

                        <Button
                            variant="destructive"
                            className="cursor-pointer"
                            onClick={() => deleting?.seeding ? mark(deleting, true, true) : destroy(deleting!, true)}
                        >
                            <Trash2 /> Delete the files too
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
