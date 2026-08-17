'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Check, Download, Filter, FilterX, Loader2, Search, TriangleAlert } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/context/locale";
import { useWatchlist } from "@/context/watchlist";
import { MessageKey, Translate } from "@/i18n";
import { coversText, episodeListText } from "@/lib/library-view";
import { RejectionCode } from "@/types/download";
import { ReleaseHit, ReleaseSearch } from "@/types/release-search";

/**
 * The manual search page: what the indexers actually have for a name, in one flat list.
 *
 * It is the one place in the app where the quality profile is a button rather than a rule.
 * The server sends every release either way, each carrying the reason the profile would
 * have refused it, so the filter hides and shows rows that are already here — a search
 * costs tens of seconds and changing your mind about the filter must not cost another one.
 *
 * Coming from a title's own download dialog it arrives with the filter already off: that
 * dialog found nothing, said how many releases it had thrown away, and this is where those
 * releases are.
 */

const GB = 1024 * 1024 * 1024;

const size = (bytes: number) => {
    return bytes >= GB ? `${ (bytes / GB).toFixed(1) } GB` : `${ Math.round(bytes / (1024 * 1024)) } MB`;
};

/**
 * Why the profile refused a release, in the reader's language — the same words the release
 * dialog uses, because it is the same decision being reported.
 *
 * Three of them cannot reach this page: `no-link`, because a release with nothing to
 * download is not offered at all, and the two size ones, because the size limits are left
 * out of the profile this page judges with. They stay in the map so it covers every code —
 * a rule that comes back should not leave a blank line behind.
 */
const REJECTION: Record<RejectionCode, MessageKey> = {
    "no-link": "download.rejection.noLink",
    blocked: "download.rejection.blocked",
    seeders: "download.rejection.seeders",
    "too-big": "download.rejection.tooBig",
    excluded: "download.rejection.excluded",
    mismatch: "download.rejection.mismatch",
    language: "download.rejection.language",
    resolution: "download.rejection.resolution",
    "too-small": "download.rejection.tooSmall"
};

const ago = (value: string, t: Translate) => {
    if (! value) {
        return "";
    }

    const at = new Date(value).getTime();

    if (! Number.isFinite(at)) {
        return "";
    }

    const minutes = Math.round((Date.now() - at) / 60000);

    if (minutes < 60) {
        return t("common.minutesAgo", { n: Math.max(minutes, 1) });
    }

    const hours = Math.round(minutes / 60);

    return hours < 48 ? t("common.hoursAgo", { n: hours }) : t("common.daysAgo", { n: Math.round(hours / 24) });
};

/**
 * Everything about the torrent itself, in one line. The language goes first for the same
 * reason it does in the release dialog: it is the one thing here that decides whether the
 * file is watchable at all, and the release name is its only record.
 */
const details = (hit: ReleaseHit, t: Translate) => [
    hit.languages.join("/").toUpperCase(),
    hit.resolution,
    hit.codec,
    size(hit.size),
    t("releaseSearch.seeders", { n: hit.seeders, p: hit.peers }),
    hit.indexer,
    ago(hit.published, t)
].filter(Boolean).join(" · ");

type RowState = "idle" | "starting" | "started";

function Row({ hit, state, onDownload }: {
    hit: ReleaseHit;
    state: RowState;
    onDownload: () => void;
}) {
    const { t } = useLocale();
    const match = hit.match;
    const covers = match ? coversText(match.episodeKeys, t) : "";

    return (
        <div className="flex min-w-0 items-start gap-3 rounded-md border p-3">
            {/* small on purpose: it is here to be recognised out of the corner of an eye,
                not to be looked at — the release name is what this list is about */}
            {match?.poster
                ? <Image src={match.poster} alt="" width={40} height={60} className="shrink-0 rounded-sm" />
                : <div className="flex h-[60px] w-[40px] shrink-0 items-center justify-center rounded-sm border text-center text-[8px] leading-tight text-muted-foreground">
                    { t("releaseSearch.noImage") }
                </div>}

            <div className="min-w-0 flex-1 space-y-1">
                {/* the full name never fits, and it is the thing people scan this list for
                    — so it is truncated on the line and whole in the tooltip */}
                <div className="truncate text-sm font-medium" title={hit.title}>{ hit.title }</div>

                <div className="truncate text-xs text-muted-foreground">{ details(hit, t) }</div>

                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {match
                        ? <>
                            {/* what this would be filed under, before it is: the whole
                                attribution is read out of the release name, so it is the
                                one thing on the row worth checking */}
                            <Link
                                href={`/details/${ match.type }/${ match.tmdbId }`}
                                className="truncate text-muted-foreground hover:text-foreground hover:underline"
                            >
                                { match.name }{ match.year ? ` (${ match.year })` : "" }
                            </Link>

                            {covers && (
                                <span className="text-muted-foreground" title={episodeListText(match.episodeKeys)}>
                                    · { covers }
                                </span>
                            )}

                            {match.type === "tv" && match.episodeKeys.length === 0 && (
                                <span className="text-amber-500">· { t("releaseSearch.noEpisodes") }</span>
                            )}

                            {match.held && <Badge variant="secondary">{ t("releaseSearch.inLibrary") }</Badge>}
                        </>
                        : <span className="flex items-center gap-1 text-amber-500">
                            <TriangleAlert className="size-3 shrink-0" />
                            { t("releaseSearch.unknownTitle") }
                        </span>}
                </div>

                {/* amber rather than muted: this one is here to be readable, because taking
                    it is going against what the profile decided */}
                {hit.rejection && (
                    <div className="truncate text-xs text-amber-500">{ t(REJECTION[hit.rejection]) }</div>
                )}
            </div>

            {match && <Button
                size="sm"
                variant={state === "started" ? "secondary" : "outline"}
                className="shrink-0 cursor-pointer"
                disabled={state !== "idle"}
                onClick={onDownload}
            >
                {state === "starting" && <Loader2 className="animate-spin" />}
                {state === "started" && <Check />}
                {state === "idle" && <Download />}

                { t(state === "started" ? "releaseSearch.started" : "releaseSearch.download") }
            </Button>}
        </div>
    );
}

/**
 * One query's answer. Keyed on the query by the component below, so arriving with a new
 * one is a new mount rather than a reset — including whatever was started, which belongs
 * to the search it was started from.
 */
function Results({ query, hintType, hintId, profileOff }: {
    query: string;
    // the title somebody arrived from, as two plain values: an object here would be a new
    // one on every render of the page above, and this is what the search runs on
    hintType: string;
    hintId: string;
    profileOff: boolean;
}) {
    const { t } = useLocale();
    const { refresh } = useWatchlist();
    const router = useRouter();

    const [ typed, setTyped ] = useState(query);
    const [ result, setResult ] = useState<ReleaseSearch>();
    const [ isLoading, setLoading ] = useState(false);
    const [ failed, setFailed ] = useState("");
    // the profile is a view over what is already here, so it is not in the address: only
    // how the page was arrived at is
    const [ withProfile, setWithProfile ] = useState(! profileOff);
    const [ states, setStates ] = useState<Record<string, RowState>>({});
    const request = useRef(0);

    const search = useCallback(async () => {
        if (! query) {
            setResult(undefined);

            return;
        }

        const ticket = ++request.current;

        setLoading(true);
        setFailed("");

        try {
            const res = await axios.get("/api/search/releases", {
                params: {
                    q: query,
                    ...(hintType && hintId ? { type: hintType, id: hintId } : {})
                }
            });

            if (ticket === request.current) {
                setResult(res.data.result);
                setStates({});
            }

        } catch(err) {
            console.error(err);

            if (ticket === request.current) {
                // the indexers being unconfigured or unreachable is the answer here, not a
                // toast that disappears: this page has nothing else to show
                setFailed(axios.isAxiosError(err) && err.response?.data?.message || t("releaseSearch.searchFailed"));
                setResult(undefined);
            }

        } finally {
            if (ticket === request.current) {
                setLoading(false);
            }
        }
    }, [ query, hintType, hintId, t ]);

    // an indexer search is seconds, not keystrokes: it runs for what is in the address,
    // and the address changes when somebody presses the button or Enter
    useEffect(() => {
        void search();
    }, [ search ]);

    /**
     * A new query is a new address, so it can be shared and so going back does what it
     * says. The title somebody arrived from is dropped here on purpose: from this point on
     * the words are theirs, and a release that resolves to nothing must not quietly be
     * filed under whatever page this search was started from.
     */
    const submit = () => {
        const wanted = typed.trim();

        if (! wanted || wanted === query) {
            void search();

            return;
        }

        router.replace(`/releases?q=${ encodeURIComponent(wanted) }${ withProfile ? "" : "&profile=0" }`);
    };

    const download = async (hit: ReleaseHit) => {
        if (! result) {
            return;
        }

        setStates(prev => ({ ...prev, [hit.guid]: "starting" }));

        try {
            const res = await axios.post("/api/download/manual", { searchId: result.searchId, guid: hit.guid });

            toast(res.data.message);
            setStates(prev => ({ ...prev, [hit.guid]: "started" }));

        } catch(err) {
            console.error(err);

            setStates(prev => ({ ...prev, [hit.guid]: "idle" }));

            // the search behind the list is only kept for a while, and searching again is
            // the only honest answer — the list refills itself
            if (axios.isAxiosError(err) && err.response?.status === 410) {
                toast(t("releaseSearch.expired"));

                void search();

            } else {
                toast(axios.isAxiosError(err) && err.response?.data?.message || t("releaseSearch.startFailed"));
            }

        } finally {
            await refresh();
        }
    };

    const hits = (result?.hits || []).filter(hit => ! withProfile || ! hit.rejection);

    // counted off the list rather than taken from the answer's own `filtered`: that one
    // also counts the releases with nothing to download, which are on nobody's screen —
    // and a sentence about "these" has to be about what is on this one
    const refused = (result?.hits || []).filter(hit => !! hit.rejection).length;

    return (
        <div className="p-4">
            <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">{ t("releaseSearch.title") }</h2>
                <p className="max-w-4xl text-sm text-muted-foreground">{ t("releaseSearch.intro") }</p>
            </div>

            <Separator className="my-5" />

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 sm:max-w-md">
                    <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />

                    <Input
                        value={typed}
                        placeholder={t("releaseSearch.placeholder")}
                        className="pl-8"
                        autoFocus
                        onChange={event => setTyped(event.currentTarget.value)}
                        onKeyDown={event => { if (event.key === "Enter") { submit(); } }}
                    />
                </div>

                <Button className="cursor-pointer" disabled={isLoading || ! typed.trim()} onClick={submit}>
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isLoading })} />
                    { t("releaseSearch.search") }
                </Button>

                {/* the whole point of this page, so it is next to the search and not in a
                    menu: with it off, what is on screen is what the indexers answered */}
                <Button
                    variant={withProfile ? "outline" : "default"}
                    className="cursor-pointer"
                    title={t(withProfile ? "releaseSearch.filterOnHint" : "releaseSearch.filterOffHint")}
                    onClick={() => setWithProfile(! withProfile)}
                >
                    {withProfile ? <Filter /> : <FilterX />}
                    { t(withProfile ? "releaseSearch.filterOn" : "releaseSearch.filterOff") }
                </Button>
            </div>

            <p className="pt-3 text-sm text-muted-foreground">
                {! query && t("releaseSearch.prompt")}

                {query && isLoading && t("releaseSearch.searching", { query })}

                {query && ! isLoading && failed && <span className="text-amber-500">{ failed }</span>}

                {query && ! isLoading && ! failed && result && [
                    t("releaseSearch.found", { n: hits.length }),
                    result.hits.length < result.total ? t("releaseSearch.capped", { n: result.hits.length, total: result.total }) : "",
                    withProfile && refused > 0 ? t("releaseSearch.hidden", { n: refused }) : "",
                    ! withProfile && refused > 0 ? t("releaseSearch.showingFiltered", { n: refused }) : ""
                ].filter(Boolean).join(" · ")}
            </p>

            {isLoading && <div className="space-y-2 pt-4">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[86px] w-full" />)}
            </div>}

            {! isLoading && ! failed && result && hits.length === 0 && (
                <p className="pt-4 text-sm text-muted-foreground">
                    { withProfile && refused > 0
                        ? t("releaseSearch.allFiltered", { n: refused })
                        : t("releaseSearch.nothing", { query }) }
                </p>
            )}

            {! isLoading && hits.length > 0 && <div className="min-w-0 space-y-2 pt-4">
                {hits.map(hit => (
                    <Row
                        key={hit.guid}
                        hit={hit}
                        state={states[hit.guid] || "idle"}
                        onDownload={() => download(hit)}
                    />
                ))}
            </div>}
        </div>
    );
}

export function ReleaseSearchPage() {
    const params = useSearchParams();
    const { locale } = useLocale();

    const query = (params.get("q") || "").trim();
    const hintType = params.get("type") || "";
    const hintId = params.get("id") || "";
    const profileOff = params.get("profile") === "0";

    // the language is in the key because the titles and posters on these rows are TMDB's
    // answer in it, and the query is in it because a new search is a new mount
    return <Results
        key={`${ locale }:${ query }:${ profileOff }`}
        query={query}
        hintType={hintType}
        hintId={hintId}
        profileOff={profileOff}
    />;
}
