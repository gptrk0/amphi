'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import axios from "axios";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, BookmarkX, ChevronsUpDown, Loader2, RefreshCw } from "lucide-react";
import classNames from "classnames";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WatchlistBadge } from "@/components/watchlist-badge";
import { useSession } from "@/context/session";
import { useWatchlist } from "@/context/watchlist";
import { WatchlistRowItem, WatchlistStatus } from "@/types/watchlist";

type Column = {
    key: string;
    label: string;
    // what the column sorts on; a column without it cannot be sorted
    value?: (item: WatchlistRowItem) => string | number;
    render: (item: WatchlistRowItem) => ReactNode;
    className?: string;
    // only drawn while an administrator is looking at everybody's lists
    everybody?: boolean;
};

const STATUS_FILTERS: { label: string, value: WatchlistStatus | "ALL" }[] = [
    { label: "All", value: "ALL" },
    { label: "Watchlisted", value: "PENDING" },
    { label: "Not out yet", value: "UPCOMING" },
    { label: "Waiting for release", value: "SEARCHING" }
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

/**
 * Why an item is sitting there doing nothing: it is not out yet. Without the date the
 * row shows "never checked" and reads like a scanner that gave up.
 */
const airText = (value: string | null) => {
    if (! value) {
        return "";
    }

    const date = new Date(value);
    const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
    const text = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    return days > 0 ? `out ${ text }, in ${ days } day${ days === 1 ? "" : "s" }` : `out ${ text }`;
};

/**
 * The wait until the next round, as a clock. Seconds only matter near the end, so
 * above a minute it counts in minutes and seconds and nothing jumps about.
 */
const untilText = (deadline: number | null, now: number) => {
    if (! deadline) {
        return "";
    }

    const seconds = Math.max(Math.round((deadline - now) / 1000), 0);

    if (seconds === 0) {
        return "next scan: any moment";
    }

    if (seconds < 60) {
        return `next scan in ${ seconds }s`;
    }

    const minutes = Math.floor(seconds / 60);

    return `next scan in ${ minutes }:${ String(seconds % 60).padStart(2, "0") }`;
};

/**
 * What is still to be found. A download is not here — the moment one starts, what
 * it covers has nothing left to look for and moves to the library.
 */
export function WatchlistTable() {
    const { entries, refresh } = useWatchlist();
    const { isAdmin } = useSession();
    const [ items, setItems ] = useState<WatchlistRowItem[]>();
    // the whole house by default: this table is where somebody goes to see what the app
    // is looking for, and half of that is other people's. The server is what decides
    // whether the answer may be everybody's — a non administrator asking for it gets
    // their own list back, and never sees the switch.
    const [ everybody, setEverybody ] = useState(true);
    const [ status, setStatus ] = useState<WatchlistStatus | "ALL">("ALL");
    const [ sort, setSort ] = useState<{ key: string, direction: "asc" | "desc" }>({ key: "addedAt", direction: "desc" });
    const [ isScanning, setScanning ] = useState(false);
    const [ nextScanAt, setNextScanAt ] = useState<number | null>(null);
    const [ now, setNow ] = useState(() => Date.now());
    const request = useRef(0);

    /**
     * An action reloads the table, and so does the optimistic update in front of
     * it, so two requests are in the air with the older one still carrying the row
     * that was just removed. Only the answer to the newest request is taken.
     */
    const load = useCallback(() => {
        const ticket = ++request.current;

        return axios.get("/api/watchlist", { params: everybody ? { all: 1 } : {} })
            .then(res => {
                if (ticket === request.current) {
                    setItems(res.data.result || []);
                }
            })
            .catch(err => console.error(err));
    }, [ everybody ]);

    /**
     * By row id and not through the shared context: an administrator looking at
     * everybody's lists is acting on a row that is not on their own, and the context
     * only knows their own.
     */
    const stopWatching = async (item: WatchlistRowItem) => {
        const name = item.media?.name || `TMDB #${ item.tmdbId }`;

        try {
            const res = await axios.delete(`/api/watchlist/${ item.id }`);

            toast(res.data.kept
                ? `${ name } is partly off the watchlist.`
                : `${ name } is off the watchlist.`);

        } catch(err) {
            console.error(err);
            toast(`Could not take ${ name } off the watchlist.`);
        }

        await refresh();
        await load();
    };

    /**
     * Unlike the scheduled round this one ignores the backoff, so nothing has to
     * wait for its next slot. The release dates still hold: asking for something
     * that is not out yet only finds fakes.
     */
    const scan = () => {
        setScanning(true);
        toast("Checking every watched item on your indexers...");

        axios.post("/api/scan", { force: true })
            .then(res => {
                toast(res.data.dryRun
                    ? `${ res.data.message } SCAN_DRY_RUN is on, so nothing was actually downloaded.`
                    : res.data.message);

                // the round that just ran is the round: the wait starts over
                setNextScanAt(res.data.nextScanAt || null);

                return load();
            })
            .catch(err => {
                console.error(err);
                toast(err.response?.data?.message || "Scan failed.");
            })
            .finally(() => setScanning(false));
    };

    const readSchedule = () => {
        return axios.get("/api/scan")
            .then(res => setNextScanAt(res.data.nextScanAt || null))
            .catch(err => console.error(err));
    };

    useEffect(() => {
        readSchedule();
    }, [])

    // one tick a second is what a countdown is; the deadline itself is only asked
    // for when it can have moved
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);

        return () => clearInterval(timer);
    }, [])

    // the round may have run on its own while the page was open, and then the
    // deadline the page holds is in the past
    useEffect(() => {
        if (nextScanAt && nextScanAt <= now) {
            readSchedule();
        }
    }, [ nextScanAt, now ])

    // a change in the shared list reloads the table. the whole state is the key, not
    // the number of rows: a download takes rows off this list, and that has to show
    const signature = entries.map(entry => `${ entry.id }:${ entry.status }:${ entry.monitored }`).join(",");

    useEffect(() => {
        load();
    }, [ signature, load ])

    const poster = (item: WatchlistRowItem) => {
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
            key: "owner",
            label: "Added by",
            everybody: true,
            value: item => item.owner.name.toLowerCase(),
            render: item => <span className="text-muted-foreground">{ item.owner.name }</span>
        },
        {
            key: "type",
            label: "Type",
            value: item => item.type,
            render: item => <span className="text-muted-foreground">{ item.type === "tv" ? "Series" : "Movie" }</span>
        },
        {
            key: "status",
            label: "Status",
            value: item => item.status,
            render: item => <WatchlistBadge entry={item} />
        },
        {
            key: "wanted",
            label: "Still wanted",
            value: item => item.episodeCount,
            render: item => (
                <div className="min-w-[7rem]">
                    <div>{ item.type === "tv" ? `${ item.episodeCount - item.downloadedCount } episodes` : "the film" }</div>

                    {item.nextAirDate && (
                        <div className="text-xs text-muted-foreground">{ airText(item.nextAirDate) }</div>
                    )}
                </div>
            )
        },
        {
            key: "addedAt",
            label: "Added",
            value: item => item.addedAt,
            render: item => <span className="text-muted-foreground">{ ago(item.addedAt) }</span>
        },
        {
            key: "lastCheckedAt",
            label: "Last checked",
            value: item => item.lastCheckedAt || "",
            render: item => <span className="text-muted-foreground">{ ago(item.lastCheckedAt) }</span>
        },
        {
            key: "searchAttempts",
            label: "Attempts",
            value: item => item.searchAttempts,
            render: item => <span className="text-muted-foreground">{ item.searchAttempts || "—" }</span>
        },
        {
            key: "actions",
            label: "",
            className: "text-right",
            render: item => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer"
                    title="Stop watching — anything already downloaded stays in the library"
                    onClick={() => stopWatching(item)}
                >
                    <BookmarkX />
                </Button>
            )
        }
    ];

    const toggleSort = (key: string) => {
        setSort(prev => prev.key === key
            ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
            : { key, direction: "asc" });
    };

    const countdown = isScanning ? "scanning..." : untilText(nextScanAt, now);

    const shown = columns.filter(column => ! column.everybody || everybody);

    const visible = (items || []).filter(item => status === "ALL" || item.status === status);
    const column = shown.find(v => v.key === sort.key);

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
                    <h2 className="text-2xl font-semibold tracking-tight">{ everybody ? "Everybody's watchlist" : "Your watchlist" }</h2>
                    <p className="text-sm text-muted-foreground">
                        What is being looked for{ everybody ? " by anybody here" : " for you" }. As soon as a release turns up it is
                        downloaded, and it moves to the library — which is shared, however many people were waiting for it.
                    </p>
                </div>

                {/* the countdown is for everybody, the button is not: a round hits every
                    indexer at once, which is an operator's decision */}
                <div className="flex shrink-0 flex-col items-end gap-1">
                    {isAdmin && <Button
                        className="cursor-pointer"
                        onClick={scan}
                        disabled={isScanning}
                        title="Check everything you watch that is already out, without waiting for its next slot"
                    >
                        <Loader2 className={classNames("animate-spin", { "hidden": ! isScanning })} />
                        <RefreshCw className={classNames({ "hidden": isScanning })} />
                        Scan now
                    </Button>}

                    <span className="text-xs text-muted-foreground">{ countdown }</span>
                </div>
            </div>

            <Separator className="my-5" />

            <div className="flex flex-wrap gap-2 pb-4">
                {isAdmin && <>
                    <Button
                        size="sm"
                        variant={everybody ? "outline" : "default"}
                        className="cursor-pointer"
                        onClick={() => setEverybody(false)}
                    >
                        Mine
                    </Button>

                    <Button
                        size="sm"
                        variant={everybody ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => setEverybody(true)}
                    >
                        Everybody
                    </Button>

                    <Separator orientation="vertical" className="mx-1 h-8" />
                </>}

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
            </div>

            {! items && <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>}

            {items && sorted.length === 0 && <p className="text-sm text-muted-foreground">
                { everybody
                    ? "Nobody is waiting for anything at the moment."
                    : "Your watchlist is empty — add something from a details page or by right clicking a poster." }
            </p>}

            {items && sorted.length > 0 && <Table>
                <TableHeader>
                    <TableRow>
                        {shown.map(col => (
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
                            {shown.map(col => (
                                <TableCell key={col.key} className={classNames(col.className, "py-1")}>
                                    { col.render(item) }
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>}
        </div>
    );
}
