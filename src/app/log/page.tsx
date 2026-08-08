'use client';

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

type Entry = {
    id: number;
    at: string;
    level: Level;
    source: string;
    message: string;
    detail: string | null;
};

type Filter = { level: string, source: string, q: string };

// the lowest level to show, so "Warnings" includes errors
const LEVELS: { label: string, value: string }[] = [
    { label: "Everything", value: "" },
    { label: "Info", value: "INFO" },
    { label: "Warnings", value: "WARN" },
    { label: "Errors", value: "ERROR" }
];

const LEVEL_STYLE: Record<Level, string> = {
    DEBUG: "text-muted-foreground",
    INFO: "border-sky-500/40 text-sky-700 dark:text-sky-400",
    WARN: "border-amber-500/50 text-amber-700 dark:text-amber-400",
    ERROR: "border-destructive/50 text-destructive"
};

// a live page can stay open for days; everything older is still one click away in the
// table, so the browser does not have to hold it
const MAX_ROWS = 2000;

const SEARCH_DEBOUNCE_MS = 300;

const stamp = (value: string) => {
    const date = new Date(value);
    const time = date.toLocaleTimeString("en-GB", { hour12: false });

    // the day is only worth the space when it is not today
    if (date.toDateString() === new Date().toDateString()) {
        return time;
    }

    return `${ date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) } ${ time }`;
};

const toQuery = (filter: Filter, extra: Record<string, number> = {}) => {
    const params = new URLSearchParams();

    for (const [ key, value ] of Object.entries(filter)) {
        if (value !== "") {
            params.set(key, value);
        }
    }

    // an id of 0 is "nothing to start from", which is the same as not sending it
    for (const [ key, value ] of Object.entries(extra)) {
        if (value > 0) {
            params.set(key, String(value));
        }
    }

    return params.toString();
};

export default function Page() {
    const [ entries, setEntries ] = useState<Entry[]>();
    const [ sources, setSources ] = useState<{ source: string, count: number }[]>([]);
    const [ hasMore, setHasMore ] = useState(false);
    const [ isLoadingMore, setLoadingMore ] = useState(false);

    const [ level, setLevel ] = useState("");
    const [ source, setSource ] = useState("");
    const [ search, setSearch ] = useState("");
    const [ query, setQuery ] = useState("");

    const [ isLive, setLive ] = useState(true);
    const [ isConnected, setConnected ] = useState(false);

    // bumped by every finished load, and only then, so the stream always opens with the
    // cursor that page left behind. 0 means "no page yet, do not open one"
    const [ streamKey, setStreamKey ] = useState(0);
    const [ reload, setReload ] = useState(0);

    // the newest id the page has seen. A ref because the stream must not reopen every
    // time an entry arrives
    const since = useRef(0);

    const filter: Filter = { level, source, q: query };

    useEffect(() => {
        const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [ search ]);

    useEffect(() => {
        let cancelled = false;

        setEntries(undefined);
        setStreamKey(0);

        axios.get(`/api/log?${ toQuery({ level, source, q: query }) }`)
            .then(res => {
                if (cancelled) {
                    return;
                }

                setEntries(res.data.entries);
                setSources(res.data.sources);
                setHasMore(res.data.hasMore);

                since.current = res.data.newestId;
                setStreamKey(key => key + 1);
            })
            .catch(err => {
                console.error(err);
                toast("Could not read the log.");
            });

        return () => {
            cancelled = true;
        };
    }, [ level, source, query, reload ]);

    useEffect(() => {
        if (! isLive || streamKey === 0) {
            return;
        }

        const stream = new EventSource(`/api/log/stream?${ toQuery({ level, source, q: query }, { after: since.current }) }`);

        stream.onopen = () => setConnected(true);
        // EventSource reconnects on its own, and it tells the server where it stopped —
        // so this only has to say that the light is amber for the moment
        stream.onerror = () => setConnected(false);

        stream.addEventListener("entries", (event) => {
            const rows: Entry[] = JSON.parse((event as MessageEvent).data);

            setConnected(true);
            setEntries(prev => {
                const known = new Set((prev || []).map(entry => entry.id));
                const fresh = rows.filter(row => ! known.has(row.id));

                if (fresh.length === 0) {
                    return prev;
                }

                since.current = Math.max(since.current, ...fresh.map(row => row.id));

                // the stream sends them in the order they happened, the page shows the
                // newest first
                return [ ...fresh.reverse(), ...(prev || []) ].slice(0, MAX_ROWS);
            });
        });

        return () => {
            stream.close();
            setConnected(false);
        };
    }, [ isLive, streamKey, level, source, query ]);

    const loadMore = async () => {
        const oldest = entries?.[entries.length - 1]?.id;

        if (! oldest) {
            return;
        }

        setLoadingMore(true);

        try {
            const res = await axios.get(`/api/log?${ toQuery(filter, { before: oldest }) }`);

            setEntries(prev => [ ...(prev || []), ...res.data.entries ]);
            setHasMore(res.data.hasMore);

        } catch(err) {
            console.error(err);
            toast("Could not read the log.");

        } finally {
            setLoadingMore(false);
        }
    };

    const clear = async () => {
        if (! window.confirm("Clear the whole log? Every entry goes, including the ones this page is not showing.")) {
            return;
        }

        try {
            const res = await axios.delete("/api/log");

            toast(`${ res.data.cleared } entr${ res.data.cleared === 1 ? "y" : "ies" } cleared.`);
            setReload(value => value + 1);

        } catch(err) {
            console.error(err);
            toast("Could not clear the log.");
        }
    };

    const sourceLabel = source || "Every source";

    return (
        <div className="p-4 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">Log</h2>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                        What the app did while nobody was watching — every grab, every release it
                        threw away and every setting that was changed. New lines arrive as they
                        happen. Old ones are dropped after the retention set under Settings / Log.
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Switch className="cursor-pointer" checked={isLive} onCheckedChange={setLive} />

                        <span className={classNames("size-1.5 rounded-full", {
                            "bg-emerald-500": isLive && isConnected,
                            "bg-amber-500": isLive && ! isConnected,
                            "bg-muted-foreground/40": ! isLive
                        })} />

                        Live
                    </label>

                    <Button variant="outline" size="sm" className="cursor-pointer" onClick={clear}>
                        <Trash2 />
                        Clear
                    </Button>
                </div>
            </div>

            <Separator className="my-5" />

            <div className="flex flex-wrap items-center gap-2 pb-4">
                {LEVELS.map(item => (
                    <Button
                        key={item.value}
                        size="sm"
                        variant={level === item.value ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => setLevel(item.value)}
                    >
                        { item.label }
                    </Button>
                ))}

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="cursor-pointer">
                            { sourceLabel }
                            <ChevronDown />
                        </Button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="start">
                        <DropdownMenuRadioGroup value={source} onValueChange={setSource}>
                            <DropdownMenuRadioItem value="" className="cursor-pointer">Every source</DropdownMenuRadioItem>

                            {sources.map(item => (
                                <DropdownMenuRadioItem key={item.source} value={item.source} className="cursor-pointer">
                                    { item.source }

                                    <span className="ml-auto pl-4 text-xs text-muted-foreground">{ item.count }</span>
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>

                <Input
                    className="w-full sm:max-w-64"
                    placeholder="Search the text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {! entries && <div className="space-y-2">
                {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>}

            {entries && entries.length === 0 && <p className="text-sm text-muted-foreground">
                { level || source || query ? "Nothing matches that." : "Nothing has been logged yet." }
            </p>}

            {entries && entries.length > 0 && <div className="divide-y">
                {entries.map(entry => (
                    <div
                        key={entry.id}
                        className="grid gap-x-3 gap-y-1 py-2 md:grid-cols-[6rem_4.5rem_6rem_minmax(0,1fr)]"
                    >
                        <span className="font-mono text-xs text-muted-foreground md:pt-0.5">{ stamp(entry.at) }</span>

                        <div>
                            <Badge variant="outline" className={classNames("font-mono text-[10px]", LEVEL_STYLE[entry.level])}>
                                { entry.level }
                            </Badge>
                        </div>

                        <span className="font-mono text-xs text-muted-foreground md:pt-0.5">{ entry.source }</span>

                        <div className="min-w-0">
                            <p className="text-sm break-words">{ entry.message }</p>

                            {entry.detail && <p className="text-xs break-words text-muted-foreground">{ entry.detail }</p>}
                        </div>
                    </div>
                ))}
            </div>}

            {entries && hasMore && <div className="pt-4">
                <Button variant="outline" className="cursor-pointer" onClick={loadMore} disabled={isLoadingMore}>
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isLoadingMore })} />
                    Load older entries
                </Button>
            </div>}
        </div>
    );
}
