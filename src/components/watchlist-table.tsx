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
import { OptionSelect } from "@/components/option-select";
import { useLocale } from "@/context/locale";
import { WatchlistBadge } from "@/components/watchlist-badge";
import { useSession } from "@/context/session";
import { useWatchlist } from "@/context/watchlist";
import { MessageKey, Translate } from "@/i18n";
import { languageLabel, useLanguageOptions } from "@/lib/language-labels";
import { userName, useUserOptions } from "@/lib/user-options";
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

const STATUS_FILTERS: { label: MessageKey, value: WatchlistStatus | "ALL" }[] = [
    { label: "watchlistPage.all", value: "ALL" },
    { label: "status.PENDING", value: "PENDING" },
    { label: "status.UPCOMING", value: "UPCOMING" },
    { label: "status.SEARCHING", value: "SEARCHING" }
];

const ago = (value: string | null, t: Translate) => {
    if (! value) {
        return t("common.never");
    }

    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);

    if (minutes < 1) {
        return t("common.justNow");
    }

    if (minutes < 60) {
        return t("common.minutesAgo", { n: minutes });
    }

    const hours = Math.round(minutes / 60);

    return hours < 48 ? t("common.hoursAgo", { n: hours }) : t("common.daysAgo", { n: Math.round(hours / 24) });
};

/**
 * Why an item is sitting there doing nothing: it is not out yet. Without the date the
 * row shows "never checked" and reads like a scanner that gave up.
 */
const airText = (value: string | null, locale: string, t: Translate) => {
    if (! value) {
        return "";
    }

    const date = new Date(value);
    const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
    const text = date.toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", { day: "numeric", month: "short" });

    return days > 0
        ? t(days === 1 ? "watchlistPage.outTomorrow" : "watchlistPage.outIn", { date: text, n: days })
        : t("watchlistPage.outOn", { date: text });
};

/**
 * The wait until the next round, as a clock. Seconds only matter near the end, so
 * above a minute it counts in minutes and seconds and nothing jumps about.
 */
const untilText = (deadline: number | null, now: number, t: Translate) => {
    if (! deadline) {
        return "";
    }

    const seconds = Math.max(Math.round((deadline - now) / 1000), 0);

    if (seconds === 0) {
        return t("watchlistPage.nextScanAny");
    }

    if (seconds < 60) {
        return t("watchlistPage.nextScanSeconds", { n: seconds });
    }

    const minutes = Math.floor(seconds / 60);

    return t("watchlistPage.nextScanIn", { time: `${ minutes }:${ String(seconds % 60).padStart(2, "0") }` });
};

/**
 * What is still to be found. A download is not here — the moment one starts, what
 * it covers has nothing left to look for and moves to the library.
 */
export function WatchlistTable() {
    const { entries, refresh } = useWatchlist();
    const { isAdmin } = useSession();
    const { locale, t, tOr } = useLocale();
    const languageOptions = useLanguageOptions();
    // empty for anybody who is not an administrator, and then the owner column is the
    // name it has always been
    const userOptions = useUserOptions();
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
                ? t("watchlistPage.offListPartly", { name })
                : t("watchlistPage.offList", { name }));

        } catch(err) {
            console.error(err);
            toast(t("watchlistPage.offListFailed", { name }));
        }

        await refresh();
        await load();
    };

    /**
     * The language this one title is searched in. Empty gives it back to the account's
     * rule, which is where every row starts — and the row is reloaded rather than patched
     * in place, because the answer also moves what counts as already had.
     */
    const setLanguage = async (item: WatchlistRowItem, language: string) => {
        const name = item.media?.name || `TMDB #${ item.tmdbId }`;

        try {
            const res = await axios.patch(`/api/watchlist/${ item.id }`, { language });
            const wanted: string[] = res.data.result?.searchLanguages || [];

            toast(language
                ? t("watchlistPage.languageSet", { name, language: languageLabel(language, tOr) })
                : t("watchlistPage.languageAuto", { name, languages: wanted.map(code => languageLabel(code, tOr)).join(", ") }));

        } catch(err) {
            console.error(err);
            toast(axios.isAxiosError(err) && err.response?.data?.message || t("watchlistPage.languageFailed", { name }));
        }

        await load();
    };

    /**
     * Whose row this is. The app learns who wanted something from whoever pressed the
     * button, and that is not always who it was for — so an administrator can hand a row
     * over, with everything still to be found on it.
     *
     * Both lists have to be reloaded: the row may have just left or joined the watchlist
     * of the person looking at the table, and every poster in the app is badged from that.
     */
    const moveTo = async (item: WatchlistRowItem, userId: string) => {
        const name = item.media?.name || `TMDB #${ item.tmdbId }`;
        const user = userName(userOptions, userId);

        try {
            await axios.patch(`/api/watchlist/${ item.id }`, { userId: Number(userId) });

            toast(t("watchlistPage.ownerSet", { name, user }));

        } catch(err) {
            console.error(err);

            toast(axios.isAxiosError(err) && err.response?.data?.conflict
                ? t("watchlistPage.ownerTaken", { name, user })
                : t("watchlistPage.ownerFailed", { name }));
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
        toast(t("watchlistPage.scanStarted"));

        axios.post("/api/scan", { force: true })
            .then(res => {
                toast(res.data.dryRun
                    ? t("watchlistPage.scanDryRun", { message: res.data.message })
                    : res.data.message);

                // the round that just ran is the round: the wait starts over
                setNextScanAt(res.data.nextScanAt || null);

                return load();
            })
            .catch(err => {
                console.error(err);
                toast(err.response?.data?.message || t("watchlistPage.scanFailed"));
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
        // `locale` is not read in here, and is a dependency anyway: every row carries a
        // TMDB title, so the language is part of what the server answered with
    }, [ signature, load, locale ])

    const poster = (item: WatchlistRowItem) => {
        if (! item.media?.poster_img) {
            return <div className="flex h-[48px] w-[32px] shrink-0 items-center justify-center rounded-sm border text-[8px] text-muted-foreground">no<br />img</div>;
        }

        return <Image src={item.media.poster_img} alt="" width={32} height={48} className="shrink-0 rounded-sm" />;
    };

    const columns: Column[] = [
        {
            key: "name",
            label: t("watchlistPage.columns.title"),
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
            key: "language",
            label: t("watchlistPage.columns.language"),
            // sorts by what will actually be searched, not by whether it was overridden:
            // the column is there to answer "in what language", and that is the answer
            value: item => item.searchLanguages.join(","),
            render: item => (
                <div className="min-w-[11rem]">
                    <OptionSelect
                        value={item.language}
                        onChange={(next) => setLanguage(item, next)}
                        options={[
                            // no language of its own: whatever the owner's account says,
                            // which is where every row starts
                            { value: "", label: "Auto" },
                            ...languageOptions
                        ]}
                        // the table container clips, so this one hangs off the viewport
                        float
                    />
                </div>
            )
        },
        {
            key: "owner",
            label: t("watchlistPage.columns.owner"),
            everybody: true,
            value: item => item.owner.name.toLowerCase(),
            // a name for everybody, a dropdown for an administrator. Until the accounts
            // have arrived it is the name as well, rather than a select whose own value
            // is not on its list yet
            render: item => userOptions.length === 0
                ? <span className="text-muted-foreground">{ item.owner.name }</span>
                : (
                    <div className="min-w-[10rem]" title={t("watchlistPage.ownerTooltip")}>
                        <OptionSelect
                            value={String(item.owner.id)}
                            onChange={(next) => moveTo(item, next)}
                            options={userOptions}
                            // the table container clips, so this one hangs off the viewport
                            float
                        />
                    </div>
                )
        },
        {
            key: "type",
            label: t("watchlistPage.columns.type"),
            value: item => item.type,
            render: item => <span className="text-muted-foreground">{ item.type === "tv" ? t("common.series") : t("common.movie") }</span>
        },
        {
            key: "status",
            label: t("watchlistPage.columns.status"),
            value: item => item.status,
            render: item => <WatchlistBadge entry={item} />
        },
        {
            key: "wanted",
            label: t("watchlistPage.columns.wanted"),
            value: item => item.episodeCount,
            render: item => (
                <div className="min-w-[7rem]">
                    <div>{ item.type === "tv" ? t("watchlistPage.episodesLeft", { n: item.episodeCount - item.downloadedCount }) : t("common.film") }</div>

                    {item.nextAirDate && (
                        <div className="text-xs text-muted-foreground">{ airText(item.nextAirDate, locale, t) }</div>
                    )}
                </div>
            )
        },
        {
            key: "addedAt",
            label: t("watchlistPage.columns.added"),
            value: item => item.addedAt,
            render: item => <span className="text-muted-foreground">{ ago(item.addedAt, t) }</span>
        },
        {
            key: "lastCheckedAt",
            label: t("watchlistPage.columns.lastChecked"),
            value: item => item.lastCheckedAt || "",
            render: item => <span className="text-muted-foreground">{ ago(item.lastCheckedAt, t) }</span>
        },
        {
            key: "searchAttempts",
            label: t("watchlistPage.columns.attempts"),
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
                    title={t("watchlistPage.stopWatchingTitle")}
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

    const countdown = isScanning ? t("watchlistPage.scanning") : untilText(nextScanAt, now, t);

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
                    <h2 className="text-2xl font-semibold tracking-tight">{ t(everybody ? "watchlistPage.titleEverybody" : "watchlistPage.titleMine") }</h2>
                    <p className="text-sm text-muted-foreground">
                        { t(everybody ? "watchlistPage.introEverybody" : "watchlistPage.introMine") }
                    </p>
                </div>

                {/* the countdown is for everybody, the button is not: a round hits every
                    indexer at once, which is an operator's decision */}
                <div className="flex shrink-0 flex-col items-end gap-1">
                    {isAdmin && <Button
                        className="cursor-pointer"
                        onClick={scan}
                        disabled={isScanning}
                        title={t("watchlistPage.scanTitle")}
                    >
                        <Loader2 className={classNames("animate-spin", { "hidden": ! isScanning })} />
                        <RefreshCw className={classNames({ "hidden": isScanning })} />
                        { t("watchlistPage.scanNow") }
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
                        { t("watchlistPage.mine") }
                    </Button>

                    <Button
                        size="sm"
                        variant={everybody ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => setEverybody(true)}
                    >
                        { t("watchlistPage.everybody") }
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
                        { t(filter.label) }
                    </Button>
                ))}
            </div>

            {! items && <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>}

            {items && sorted.length === 0 && <p className="text-sm text-muted-foreground">
                { t(everybody ? "watchlistPage.emptyEverybody" : "watchlistPage.emptyMine") }
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
