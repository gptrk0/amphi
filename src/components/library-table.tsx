'use client';

import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import axios from "axios";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsUpDown, Clock, Pencil, Trash2, Undo2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { OptionCheckboxes } from "@/components/option-checkboxes";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocale } from "@/context/locale";
import { useSession } from "@/context/session";
import { useWatchlist } from "@/context/watchlist";
import { MessageKey, Translate } from "@/i18n";
import {
    coversText,
    episodeListText,
    Group,
    groupEpisodes,
    groupSize,
    toGroups,
    unique
} from "@/lib/library-view";
import { userName, useUserOptions } from "@/lib/user-options";
import { KeepRange, LibraryItem } from "@/types/library";

type Column = {
    key: string;
    label: string;
    value?: (item: LibraryItem) => string | number;
    render: (item: LibraryItem) => ReactNode;
    // the same cell for a title with several downloads under it. What it cannot add up —
    // the seed window, the retention, the delete button — stays on the rows inside
    groupValue?: (group: Group) => string | number;
    groupRender?: (group: Group) => ReactNode;
    // the cell inside an open group, where the title and poster are already on the row above
    childRender?: (item: LibraryItem) => ReactNode;
    className?: string;
};

// while something is downloading the percentages move, so the table has to keep up.
// The slow one is for everything else: the library is shared, and a download somebody
// else starts has to turn up here without the page being reloaded.
const POLL_MS = 5000;
const IDLE_POLL_MS = 20000;

const FILTERS: { label: MessageKey, value: "ALL" | "DOWNLOADING" | "AVAILABLE" }[] = [
    { label: "libraryPage.filters.all", value: "ALL" },
    { label: "libraryPage.filters.downloading", value: "DOWNLOADING" },
    { label: "libraryPage.filters.available", value: "AVAILABLE" }
];

const speed = (bytesPerSecond: number, t: Translate) => {
    if (bytesPerSecond < 1024 * 1024) {
        return t("libraryPage.kbPerSecond", { n: Math.round(bytesPerSecond / 1024) });
    }

    return t("libraryPage.mbPerSecond", { n: (bytesPerSecond / (1024 * 1024)).toFixed(1) });
};

const remaining = (seconds: number | null, t: Translate) => {
    if (seconds === null) {
        return "";
    }

    return seconds < 3600
        ? t("libraryPage.minutesLeft", { n: Math.round(seconds / 60) })
        : t("libraryPage.hoursLeft", { n: Math.round(seconds / 3600) });
};

/**
 * GB for anything worth calling GB, MB below that. Two decimals would be noise here —
 * this column answers "what is filling the disk", not "how many bytes exactly".
 */
const sizeText = (bytes: number | null) => {
    if (! bytes) {
        return "—";
    }

    const gb = bytes / 1024 ** 3;

    return gb >= 1 ? `${ gb.toFixed(gb >= 10 ? 0 : 1) } GB` : `${ Math.max(Math.round(bytes / 1024 ** 2), 1) } MB`;
};

const ago = (value: string | null, t: Translate) => {
    if (! value) {
        return "—";
    }

    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);

    if (minutes < 60) {
        return t("common.minutesAgo", { n: Math.max(minutes, 1) });
    }

    const hours = Math.round(minutes / 60);

    return hours < 48
        ? t("common.hoursAgo", { n: hours })
        : t("common.daysAgo", { n: Math.round(hours / 24) });
};

/** How long until a moment that has consequences. Empty once it has passed. */
const untilText = (value: string | null, t: Translate) => {
    if (! value) {
        return "";
    }

    const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3600000);

    if (hours <= 0) {
        return "";
    }

    return hours < 48
        ? t("libraryPage.hours", { n: hours })
        : t("libraryPage.days", { n: Math.ceil(hours / 24) });
};

/** How much of the seed time is left, which is the only thing blocking a delete. */
const seedText = (value: string | null, t: Translate) => {
    const left = untilText(value, t);

    return left ? t("libraryPage.timeLeft", { time: left }) : "";
};

/**
 * What is on disk or on its way there — one row per torrent, because seeding and
 * deleting are what a torrent does, not what a title does.
 */
export function LibraryTable() {
    const { refresh } = useWatchlist();
    const { isAdmin } = useSession();
    const { locale, t } = useLocale();
    // empty for anybody who is not an administrator, and then the requesters are the
    // names they have always been
    const userOptions = useUserOptions();
    const [ items, setItems ] = useState<LibraryItem[]>();
    const [ filter, setFilter ] = useState<"ALL" | "DOWNLOADING" | "AVAILABLE">("ALL");
    const [ sort, setSort ] = useState<{ key: string, direction: "asc" | "desc" }>({ key: "startedAt", direction: "desc" });
    const [ deleting, setDeleting ] = useState<LibraryItem | null>(null);
    const [ keeping, setKeeping ] = useState<LibraryItem | null>(null);
    const [ keepInput, setKeepInput ] = useState("");
    // which download's requesters are being edited, and the ids ticked so far — the same
    // comma separated shape every other closed list in the app is edited in
    const [ asking, setAsking ] = useState<LibraryItem | null>(null);
    const [ askedFor, setAskedFor ] = useState("");
    // which titles are open. Null until somebody opens or closes one: until then a title
    // with something still downloading is open on its own, so the percentages are visible
    // without a click
    const [ expanded, setExpanded ] = useState<string[] | null>(null);
    // the floor is the seed time, which is a setting — until the first answer arrives the
    // input is guarded by the api rather than by these
    const [ range, setRange ] = useState<KeepRange>({ min: 1, max: 60 });
    const request = useRef(0);

    const load = () => {
        const ticket = ++request.current;

        return axios.get("/api/library", { params: { live: 1 } })
            .then(res => {
                if (ticket === request.current) {
                    setItems(res.data.result || []);

                    if (res.data.keepRange) {
                        setRange(res.data.keepRange);
                    }
                }
            })
            .catch(err => console.error(err));
    };

    // on mount, and again on a change of language: these rows are TMDB titles, and the poll
    // below would only catch up to the new language a minute later
    useEffect(() => {
        load();
    }, [ locale ])

    // it never stops: this table is the whole household's, and the row that appears is
    // as often somebody else's new download as it is a percentage of your own
    useEffect(() => {
        const busy = items?.some(item => item.status === "DOWNLOADING");
        const timer = setInterval(load, busy ? POLL_MS : IDLE_POLL_MS);

        return () => clearInterval(timer);
    }, [ items ])

    const name = (item: LibraryItem) => item.media?.name || `TMDB #${ item.tmdbId }`;

    const mark = async (item: LibraryItem, deleteRequested: boolean) => {
        setDeleting(null);

        try {
            await axios.patch(`/api/library/${ item.id }`, { deleteRequested });

            toast(deleteRequested
                ? t("libraryPage.markedToast", { name: name(item) })
                : t("libraryPage.stayingToast", { name: name(item) }));

        } catch(err) {
            console.error(err);
            toast(t("libraryPage.updateFailed", { name: name(item) }));

        } finally {
            await load();
        }
    };

    const destroy = async (item: LibraryItem) => {
        setDeleting(null);

        try {
            await axios.delete(`/api/library/${ item.id }`);

            toast(t("libraryPage.deletedToast", { name: name(item) }));

        } catch(err) {
            console.error(err);
            toast(t("libraryPage.deleteFailed", { name: name(item) }));

        } finally {
            await load();
            await refresh();
        }
    };

    /** How long this one stays. `null` hands it back to the default for its shape. */
    const keep = async (item: LibraryItem, days: number | null) => {
        setKeeping(null);

        try {
            await axios.patch(`/api/library/${ item.id }`, { keepDays: days });

            toast(days === null
                ? t("libraryPage.keepDefaultToast", { name: name(item), n: item.keepDaysDefault })
                : t("libraryPage.keepToast", { name: name(item), n: days }));

        } catch(err) {
            console.error(err);
            toast(t("libraryPage.updateFailed", { name: name(item) }));

        } finally {
            await load();
        }
    };

    const askKeep = (item: LibraryItem) => {
        setKeepInput(String(item.keepDays));
        setKeeping(item);
    };

    /**
     * Who this download was for. The app fills it in from whose watchlists the grab
     * emptied, and a download started from a details page is credited to whoever pressed
     * the button — so the one thing it cannot know is who else it was really for.
     *
     * Not cosmetic: this list is who is told when it lands or goes, and whose watchlist it
     * returns to if it never lands. Per download rather than per title, for the same reason
     * the retention is: a Hungarian copy and an English one of the same film are two rows
     * because they answer two different people.
     */
    const setWatchers = async (item: LibraryItem, ids: number[]) => {
        setAsking(null);

        try {
            await axios.patch(`/api/library/${ item.id }`, { watchedBy: ids });

            toast(ids.length === 0
                ? t("libraryPage.watchersNoneToast", { name: name(item) })
                : t("libraryPage.watchersToast", {
                    name: name(item),
                    users: ids.map(id => userName(userOptions, id)).join(", ")
                }));

        } catch(err) {
            console.error(err);
            toast(t("libraryPage.updateFailed", { name: name(item) }));

        } finally {
            await load();
        }
    };

    const askWatchers = (item: LibraryItem) => {
        setAskedFor(item.watcherIds.join(","));
        setAsking(item);
    };

    const askedIds = askedFor.split(",").map(Number).filter(Boolean);

    const wantedDays = Number(keepInput);
    const keepValid = Number.isInteger(wantedDays) && wantedDays >= range.min && wantedDays <= range.max;

    const poster = (item: LibraryItem) => {
        if (! item.media?.poster_img) {
            return <div className="flex h-[48px] w-[32px] shrink-0 items-center justify-center rounded-sm border text-[8px] text-muted-foreground">{ t("libraryPage.noImage") }</div>;
        }

        return <Image src={item.media.poster_img} alt="" width={32} height={48} className="shrink-0 rounded-sm" />;
    };

    // the filter is a question about downloads, so it is asked before the grouping: a
    // series with one episode still running shows only that one under "Downloading"
    const groups = toGroups((items || []).filter(item => filter === "ALL" || item.status === filter));

    const open = expanded ?? groups
        .filter(group => group.items.length > 1 && group.items.some(item => item.status === "DOWNLOADING"))
        .map(group => group.key);

    const toggleOpen = (key: string) => {
        setExpanded(open.includes(key) ? open.filter(v => v !== key) : [ ...open, key ]);
    };

    const columns: Column[] = [
        {
            key: "name",
            label: t("libraryPage.columns.title"),
            value: item => item.media?.name?.toLowerCase() || String(item.tmdbId),
            render: item => (
                <div className="flex items-center gap-3">
                    { poster(item) }

                    <div className="min-w-0">
                        <Link href={`/details/${ item.type }/${ item.tmdbId }`} className="font-medium hover:underline">
                            { name(item) }
                        </Link>

                        {item.episodeKeys.length > 0 && (
                            <div className="text-xs text-muted-foreground" title={episodeListText(item.episodeKeys)}>
                                { coversText(item.episodeKeys, t) }
                            </div>
                        )}
                    </div>
                </div>
            ),
            groupValue: group => group.items[0].media?.name?.toLowerCase() || String(group.items[0].tmdbId),
            groupRender: group => {
                const item = group.items[0];
                const isOpen = open.includes(group.key);
                const episodes = groupEpisodes(group);

                return (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="cursor-pointer"
                            title={t(isOpen ? "libraryPage.hideDownloads" : "libraryPage.showDownloads")}
                            onClick={() => toggleOpen(group.key)}
                        >
                            {isOpen
                                ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                                : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                        </button>

                        { poster(item) }

                        <div className="min-w-0">
                            <Link href={`/details/${ item.type }/${ item.tmdbId }`} className="font-medium hover:underline">
                                { name(item) }
                            </Link>

                            {/* what the house has of this title, added up — and the exact
                                list in the tooltip, which is the question a summary of a
                                series fetched episode by episode always raises */}
                            <div className="text-xs text-muted-foreground" title={episodes.length > 0 ? episodeListText(episodes) : undefined}>
                                { episodes.length > 0
                                    ? coversText(episodes, t)
                                    : t("libraryPage.editionCount", { n: group.items.length }) }
                            </div>
                        </div>
                    </div>
                );
            },
            // the poster and the title are on the row above; what this download covers is
            // the one thing that tells it from its siblings
            childRender: item => (
                <div className="pl-[3.25rem] text-xs text-muted-foreground" title={item.episodeKeys.length > 0 ? episodeListText(item.episodeKeys) : undefined}>
                    { coversText(item.episodeKeys, t) || "—" }
                </div>
            )
        },
        {
            key: "release",
            label: t("libraryPage.columns.release"),
            value: item => item.releaseTitle.toLowerCase(),
            render: item => (
                <span className="block max-w-[22rem] truncate text-xs text-muted-foreground" title={item.releaseTitle}>
                    { item.releaseTitle || "—" }
                </span>
            ),
            // a title's release names are as many as its downloads and none of them is the
            // title's own, so the group says how many there are instead
            groupValue: group => group.items.length,
            groupRender: group => (
                <span className="text-xs text-muted-foreground">
                    { t("libraryPage.downloadCount", { n: group.items.length }) }
                </span>
            )
        },
        {
            key: "language",
            label: t("libraryPage.columns.language"),
            value: item => item.language,
            // the same film can be here twice, once per language, and then this column
            // is the only thing telling the two rows apart
            render: item => (
                <span className="text-xs text-muted-foreground">
                    { item.language ? item.language.toUpperCase() : "—" }
                </span>
            ),
            groupValue: group => unique(group.items.map(item => item.language)).sort().join(" "),
            groupRender: group => {
                const languages = unique(group.items.map(item => item.language)).sort();

                return (
                    <span className="text-xs text-muted-foreground">
                        { languages.length > 0 ? languages.map(value => value.toUpperCase()).join(" · ") : "—" }
                    </span>
                );
            }
        },
        {
            key: "watchers",
            label: t("libraryPage.columns.watchers"),
            value: item => item.watchers.join(", ").toLowerCase(),
            // the file is the household's, the wanting was not: this is the only place
            // that still says whose download it was, once the watchlist rows are gone.
            // Editable, because the app only ever guessed it — but an administrator's,
            // since it decides who hears about somebody else's download
            render: item => {
                const text = item.watchers.join(", ");

                if (userOptions.length === 0) {
                    return text
                        ? <span className="block max-w-[12rem] truncate text-xs" title={text}>{ text }</span>
                        : <span className="text-xs text-muted-foreground">—</span>;
                }

                return (
                    <Button
                        variant="ghost"
                        size="sm"
                        className={classNames("h-7 max-w-[12rem] cursor-pointer px-2 text-xs font-normal", { "text-muted-foreground": ! text })}
                        title={text ? t("libraryPage.watchersTooltip") : t("libraryPage.watchersTooltipNobody")}
                        onClick={() => askWatchers(item)}
                    >
                        <Pencil className="size-3 shrink-0" />

                        <span className="truncate">{ text || t("libraryPage.watchersNobody") }</span>
                    </Button>
                );
            },
            // everybody who wanted any part of this title, each named once — and read only,
            // like the retention beside it: a title's downloads answer different people, so
            // there is no one list here to write
            groupValue: group => unique(group.items.flatMap(item => item.watchers)).join(", ").toLowerCase(),
            groupRender: group => {
                const watchers = unique(group.items.flatMap(item => item.watchers));

                return watchers.length === 0
                    ? <span className="text-xs text-muted-foreground">—</span>
                    : <span className="block max-w-[12rem] truncate text-xs" title={watchers.join(", ")}>
                        { watchers.join(", ") }
                    </span>;
            }
        },
        {
            key: "size",
            label: t("libraryPage.columns.size"),
            value: item => item.sizeBytes ?? 0,
            render: item => (
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                    { sizeText(item.sizeBytes) }
                </span>
            ),
            // what the whole title is taking up, which is the number a disk filling up
            // is asked about
            groupValue: group => groupSize(group),
            groupRender: group => (
                <span className="text-xs whitespace-nowrap">
                    { sizeText(groupSize(group) || null) }
                </span>
            )
        },
        {
            key: "status",
            label: t("libraryPage.columns.status"),
            value: item => item.status,
            render: item => (
                <div className="min-w-[8rem]">
                    {item.status === "AVAILABLE"
                        ? <Badge>{ t("libraryPage.ready") }</Badge>
                        : <Badge variant="secondary">{ t("libraryPage.downloading") }</Badge>}

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
                                speed(item.download.downloadSpeed, t),
                                remaining(item.download.eta, t)
                            ].filter(Boolean).join(" · ") }
                        </div>
                    </>}

                    {item.status === "DOWNLOADING" && ! item.download && (
                        <div className="text-xs text-muted-foreground">{ t("libraryPage.notInClient") }</div>
                    )}
                </div>
            ),
            groupValue: group => group.items.some(item => item.status === "DOWNLOADING") ? "DOWNLOADING" : "AVAILABLE",
            groupRender: group => {
                const ready = group.items.filter(item => item.status === "AVAILABLE").length;

                if (ready === group.items.length) {
                    return <Badge>{ t("libraryPage.ready") }</Badge>;
                }

                // no aggregate percentage: the downloads are different sizes and an average
                // of their progress would be a number that means nothing
                return (
                    <div className="min-w-[8rem]">
                        <Badge variant="secondary">{ t("libraryPage.downloading") }</Badge>

                        <div className="text-xs text-muted-foreground">
                            { t("libraryPage.readyOf", { done: ready, total: group.items.length }) }
                        </div>
                    </div>
                );
            }
        },
        {
            key: "seed",
            label: t("libraryPage.columns.seed"),
            value: item => item.seedUntil || "",
            render: item => {
                if (item.status !== "AVAILABLE") {
                    return <span className="text-muted-foreground">—</span>;
                }

                const left = seedText(item.seedUntil, t);

                return (
                    <div className="min-w-[7rem]">
                        <div
                            className={classNames("flex items-center gap-1", { "text-muted-foreground": ! left })}
                            // it is qBittorrent's own seeding time, so this moves out again
                            // while the torrent is paused rather than counting down anyway
                            title={t("libraryPage.seedTooltip")}
                        >
                            {left && <Clock className="size-3" />}
                            { left || t("libraryPage.freeToDelete") }
                        </div>

                        {item.deleteRequested && (
                            <div className="text-xs text-destructive">
                                { left ? t("libraryPage.goesWhenUp") : t("libraryPage.deletingNow") }
                            </div>
                        )}

                        {/* the retention is a timer nobody is watching, so the row it will
                            take says so long before it happens */}
                        {! item.deleteRequested && item.expiresAt && (
                            <div
                                className="text-xs text-muted-foreground"
                                title={t("libraryPage.retentionTooltip", { n: item.keepDays })}
                            >
                                { untilText(item.expiresAt, t) ? t("libraryPage.deletedIn", { time: untilText(item.expiresAt, t) }) : t("libraryPage.deletedNow") }
                            </div>
                        )}
                    </div>
                );
            },
            // the soonest of them, because that is the one with consequences: a collapsed
            // title must not hide that something under it goes tonight
            groupValue: group => group.items.map(item => item.expiresAt).filter(Boolean).sort()[0] || "",
            groupRender: group => {
                const marked = group.items.filter(item => item.deleteRequested).length;

                if (marked > 0) {
                    return <div className="min-w-[7rem] text-xs text-destructive">{ t("libraryPage.markedCount", { n: marked }) }</div>;
                }

                const next = group.items
                    .filter(item => ! item.deleteRequested)
                    .map(item => item.expiresAt)
                    .filter((value): value is string => !! value)
                    .sort()[0];

                const left = next ? untilText(next, t) : "";

                return (
                    <div className="min-w-[7rem] text-xs text-muted-foreground">
                        { left ? t("libraryPage.firstDeletedIn", { time: left }) : "—" }
                    </div>
                );
            }
        },
        {
            key: "keep",
            label: t("libraryPage.columns.keep"),
            value: item => item.keepDays,
            // the number the deletion above is counted from. Editable, because how long a
            // film is worth keeping is not something an install-wide setting knows: a
            // series gets its time per episode, and after that it is the household's call
            render: item => {
                const text = t("libraryPage.keepDaysValue", { n: item.keepDays });

                if (! isAdmin) {
                    return (
                        <span className={classNames("text-xs whitespace-nowrap", item.keepDaysCustom ? "" : "text-muted-foreground")}>
                            { text }
                        </span>
                    );
                }

                return (
                    <Button
                        variant="ghost"
                        size="sm"
                        className={classNames("h-7 cursor-pointer px-2 text-xs font-normal", { "text-muted-foreground": ! item.keepDaysCustom })}
                        title={t("libraryPage.keepTooltip", { n: item.keepDaysDefault })}
                        onClick={() => askKeep(item)}
                    >
                        <Pencil className="size-3" /> { text }
                    </Button>
                );
            },
            // a retention belongs to one torrent — a season pack and a single episode of
            // the same series are kept for different lengths on purpose
            groupValue: group => Math.max(...group.items.map(item => item.keepDays)),
            groupRender: () => <span className="text-xs text-muted-foreground">—</span>
        },
        {
            key: "startedAt",
            label: t("libraryPage.columns.added"),
            value: item => item.startedAt,
            render: item => <span className="text-muted-foreground">{ ago(item.startedAt, t) }</span>,
            // the latest, so a series that is still being filled in sorts as what it is:
            // something that arrived today
            groupValue: group => [ ...group.items ].map(item => item.startedAt).sort().pop() || "",
            groupRender: group => (
                <span className="text-muted-foreground">
                    { ago([ ...group.items ].map(item => item.startedAt).sort().pop() || null, t) }
                </span>
            )
        },
        {
            key: "actions",
            label: "",
            className: "text-right",
            // deleting is the one action here that cannot be undone, and the files
            // belong to everybody — so it is an administrator's
            render: item => ! isAdmin
                ? (item.deleteRequested ? <span className="text-xs text-muted-foreground">{ t("libraryPage.marked") }</span> : null)
                : (item.deleteRequested
                ? <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer"
                    title={t("libraryPage.keepTitle")}
                    onClick={() => mark(item, false)}
                >
                    <Undo2 />
                </Button>
                : <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer"
                    title={item.seeding ? t("libraryPage.markTitle") : t("libraryPage.deleteTitle")}
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

    const column = columns.find(v => v.key === sort.key);

    // a column that says nothing about a whole title sorts by its first download, which
    // for the ones that have no `groupValue` is the only row there is
    const sortValue = (group: Group) => column?.groupValue
        ? column.groupValue(group)
        : column!.value!(group.items[0]);

    const sorted = column?.value
        ? [ ...groups ].sort((a, b) => {
            const left = sortValue(a);
            const right = sortValue(b);
            const order = left < right ? -1 : left > right ? 1 : 0;

            return sort.direction === "asc" ? order : -order;
        })
        : groups;

    return (
        <div className="p-4">
            <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">{ t("libraryPage.title") }</h2>
                <p className="text-sm text-muted-foreground">{ t("libraryPage.intro") }</p>
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
                        { t(option.label) }
                    </Button>
                ))}
            </div>

            {! items && <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>}

            {items && sorted.length === 0 && (
                <p className="text-sm text-muted-foreground">{ t("libraryPage.empty") }</p>
            )}

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
                    {sorted.map(group => group.items.length === 1
                        ? <TableRow key={group.key}>
                            {columns.map(col => (
                                <TableCell key={col.key} className={classNames(col.className, "py-1")}>
                                    { col.render(group.items[0]) }
                                </TableCell>
                            ))}
                        </TableRow>
                        : <Fragment key={group.key}>
                            <TableRow>
                                {columns.map(col => (
                                    <TableCell key={col.key} className={classNames(col.className, "py-1")}>
                                        { col.groupRender ? col.groupRender(group) : null }
                                    </TableCell>
                                ))}
                            </TableRow>

                            {open.includes(group.key) && group.items.map(item => (
                                <TableRow key={item.id} className="bg-muted/30">
                                    {columns.map(col => (
                                        <TableCell key={col.key} className={classNames(col.className, "py-1")}>
                                            { (col.childRender || col.render)(item) }
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </Fragment>)}
                </TableBody>
            </Table>}

            <Dialog open={deleting !== null} onOpenChange={(open) => { if (! open) { setDeleting(null); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            { t(deleting?.seeding ? "libraryPage.markQuestion" : "libraryPage.deleteQuestion", {
                                name: deleting ? name(deleting) : t("libraryPage.thisOne")
                            }) }
                        </DialogTitle>

                        <DialogDescription>
                            {deleting?.seeding
                                ? t("libraryPage.seedingNote", { time: seedText(deleting.seedUntil, t) })
                                : t("libraryPage.deleteNote")}
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setDeleting(null)}>
                            { t("common.cancel") }
                        </Button>

                        {/* one answer only: a deletion always takes the files with it */}
                        <Button
                            variant="destructive"
                            className="cursor-pointer"
                            onClick={() => deleting?.seeding ? mark(deleting, true) : destroy(deleting!)}
                        >
                            <Trash2 /> { t(deleting?.seeding ? "libraryPage.markConfirm" : "libraryPage.deleteConfirm") }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={keeping !== null} onOpenChange={(open) => { if (! open) { setKeeping(null); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            { t("libraryPage.keepQuestion", { name: keeping ? name(keeping) : t("libraryPage.thisOne") }) }
                        </DialogTitle>

                        <DialogDescription>
                            { t("libraryPage.keepNote", { min: range.min, max: range.max }) }
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex items-center gap-2">
                        <Input
                            type="number"
                            min={range.min}
                            max={range.max}
                            value={keepInput}
                            className="w-24"
                            autoFocus
                            onChange={event => setKeepInput(event.target.value)}
                            onKeyDown={event => { if (event.key === "Enter" && keepValid) { keep(keeping!, wantedDays); } }}
                        />

                        <span className="text-sm text-muted-foreground">{ t("libraryPage.dayUnit") }</span>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setKeeping(null)}>
                            { t("common.cancel") }
                        </Button>

                        {/* only worth offering when there is a decision to take back */}
                        {keeping?.keepDaysCustom && (
                            <Button variant="outline" className="cursor-pointer" onClick={() => keep(keeping, null)}>
                                { t("libraryPage.keepDefaultButton", { n: keeping.keepDaysDefault }) }
                            </Button>
                        )}

                        <Button
                            className="cursor-pointer"
                            disabled={! keepValid}
                            onClick={() => keep(keeping!, wantedDays)}
                        >
                            { t("common.save") }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ticked rather than typed, and nobody is a valid answer: rows from before any
                of this existed have no requester at all */}
            <Dialog open={asking !== null} onOpenChange={(open) => { if (! open) { setAsking(null); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            { t("libraryPage.watchersQuestion", { name: asking ? name(asking) : t("libraryPage.thisOne") }) }
                        </DialogTitle>

                        <DialogDescription>{ t("libraryPage.watchersNote") }</DialogDescription>
                    </DialogHeader>

                    {/* a household is a handful of accounts, but the dialog must not grow
                        past the window on an install that is not */}
                    <div className="max-h-[50vh] overflow-auto">
                        <OptionCheckboxes
                            value={askedFor}
                            onChange={setAskedFor}
                            options={userOptions.map(option => ({
                                value: option.value,
                                label: option.label,
                                // two people with the same name are told apart by the
                                // address, which is the one place there is room for it
                                help: option.keywords?.[0]
                            }))}
                        />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setAsking(null)}>
                            { t("common.cancel") }
                        </Button>

                        <Button className="cursor-pointer" onClick={() => setWatchers(asking!, askedIds)}>
                            { t("common.save") }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
