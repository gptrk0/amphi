'use client';

import { useEffect, useState } from "react";
import Image from "next/image";
import axios from "axios";
import { toast } from "sonner";
import { BookmarkX, Download, ExternalLink, Play, Star } from "lucide-react";

import { MediaDetails, MediaPerson } from "@/types/media";
import { WatchlistItem } from "@/types/watchlist";
import { useDownload } from "@/context/download";
import { useWatchlist } from "@/context/watchlist";
import { CastRow } from "@/components/cast-row";
import { Fact, FactGrid } from "@/components/fact-grid";
import { MediaRow } from "@/components/media-row";
import { TrailerDialog } from "@/components/trailer-dialog";
import { WatchlistBadge } from "@/components/watchlist-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { episodeKey, SeasonInfo, SeasonPicker } from "@/components/season-picker";

const runtimeText = (minutes: number | null, isTv: boolean) => {
    if (! minutes) {
        return "";
    }

    if (isTv) {
        return `${ minutes } min / episode`;
    }

    const hours = Math.floor(minutes / 60);

    return hours > 0 ? `${ hours }h ${ minutes % 60 }m` : `${ minutes }m`;
};

const money = (value: number) => {
    if (! value) {
        return "";
    }

    if (value >= 1000000000) {
        return `$${ (value / 1000000000).toFixed(1) }B`;
    }

    return value >= 1000000 ? `$${ Math.round(value / 1000000) }M` : `$${ value.toLocaleString("en-US") }`;
};

const votes = (value: number) => {
    return value >= 1000 ? `${ (value / 1000).toFixed(1) }k` : String(value);
};

const dateText = (value: string | null | undefined) => {
    if (! value) {
        return "";
    }

    return new Date(value).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
};

/**
 * "Director: David Fincher" rather than a list of names with jobs repeated: one
 * line per job, however many people share it.
 */
const crewFacts = (crew: MediaPerson[]): Fact[] => {
    const byJob = new Map<string, string[]>();

    for (const person of crew) {
        for (const job of person.role.split(", ")) {
            byJob.set(job, [ ...(byJob.get(job) || []), person.name ]);
        }
    }

    return [ ...byJob.entries() ].map(([ job, names ]) => ({ label: job, value: names.join(", ") }));
};

const Link = ({ href, children }: { href: string, children: React.ReactNode }) => (
    <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 hover:underline"
    >
        { children } <ExternalLink className="size-3" />
    </a>
);

type Props = {
    type: string;
    tmdbId: number;
    details: MediaDetails;
    seasons: SeasonInfo[];
};

export function DetailsView({ type, tmdbId, details, seasons }: Props) {
    const [item, setItem] = useState<WatchlistItem>();
    // "<season>:<episode>" keys — the watchlist state, mirrored so a tick is instant
    const [monitored, setMonitored] = useState<Set<string>>(new Set());
    const [isSaving, setSaving] = useState(false);
    const [isTrailerOpen, setTrailerOpen] = useState(false);

    const { getEntry, remove, refresh } = useWatchlist();
    const { startDownload } = useDownload();
    const entry = getEntry(type, tmdbId);

    // the watchlist item carries the per episode monitored flags
    useEffect(() => {
        if (! entry) {
            setItem(undefined);
            return;
        }

        axios.get(`/api/watchlist/${ entry.id }`)
            .then(res => setItem(res.data.result))
            .catch(err => console.error(err));
        // the whole entry, not its id: a finished download replaces it and the
        // episode states below have to follow
    }, [ entry ])

    // whatever the server says wins, every toggle answers with the whole item
    useEffect(() => {
        const next = new Set<string>();

        for (const season of item?.seasons || []) {
            for (const episode of season.episodes || []) {
                if (episode.monitored) {
                    next.add(episodeKey(season.seasonNumber, episode.episodeNumber));
                }
            }
        }

        setMonitored(next);
    }, [ item ])

    const media = details.media;
    const isTv = media.type === "tv";
    const year = media.date ? media.date.split("-")[0] : "";

    const selection = seasons
        .map(season => {
            const picked = season.episodes
                .filter(episode => monitored.has(episodeKey(season.season_number, episode.episode_number)))
                .map(episode => episode.episode_number);

            return {
                seasonNumber: season.season_number,
                // an empty list means the whole season on the api side
                episodeNumbers: picked.length === season.episodes.length ? [] : picked,
                count: picked.length
            };
        })
        .filter(season => season.count > 0);

    const pickedCount = selection.reduce((sum, season) => sum + season.count, 0);

    /**
     * The tick is the watchlist itself: it adds the show on the first episode and
     * removes it again when the last one is unticked.
     */
    const toggle = async (seasonNumber: number, episodeNumbers: number[] | null, checked: boolean) => {
        const affected = episodeNumbers
            || seasons.find(s => s.season_number === seasonNumber)?.episodes.map(e => e.episode_number)
            || [];

        setMonitored(prev => {
            const next = new Set(prev);

            for (const episodeNumber of affected) {
                const key = episodeKey(seasonNumber, episodeNumber);

                if (checked) {
                    next.add(key);
                } else {
                    next.delete(key);
                }
            }

            return next;
        });

        setSaving(true);

        try {
            const res = await axios.patch("/api/watchlist", {
                tmdbId,
                type,
                monitored: checked,
                seasonNumber,
                ...(episodeNumbers ? { episodes: episodeNumbers } : {})
            });

            setItem(res.data.result || undefined);

        } catch(err) {
            console.error(err);
            toast("Could not update the watchlist.");

        } finally {
            setSaving(false);
            refresh();
        }
    }

    const download = () => {
        startDownload({
            type,
            tmdbId,
            name: media.name,
            seasons: selection.map(season => ({
                seasonNumber: season.seasonNumber,
                episodeNumbers: season.episodeNumbers
            }))
        });
    }

    const facts: Fact[] = [
        { label: "Status", value: details.status },
        ...(details.next_episode ? [ {
            label: "Next episode",
            value: `S${ String(details.next_episode.season_number).padStart(2, "0") }E${ String(details.next_episode.episode_number).padStart(2, "0") } · ${ dateText(details.next_episode.air_date) || "date unknown" }`
        } ] : []),
        ...crewFacts(details.crew),
        { label: isTv ? "First aired" : "Released", value: dateText(media.date) },
        ...(isTv ? [ { label: "Last aired", value: dateText(details.last_air_date) } ] : []),
        ...(isTv ? [ { label: "Episodes", value: `${ details.season_count } season${ details.season_count === 1 ? "" : "s" }, ${ details.episode_count } episodes` } ] : []),
        { label: "Runtime", value: runtimeText(details.runtime, isTv) },
        { label: "Original title", value: details.original_name !== media.name ? details.original_name : "" },
        { label: "Original language", value: details.original_language ? details.original_language.toUpperCase() : "" },
        { label: "Spoken languages", value: details.languages.join(", ") },
        ...(isTv ? [ { label: "Network", value: details.networks.map(network => network.name).join(", ") } ] : []),
        { label: "Studio", value: details.companies.slice(0, 3).map(company => company.name).join(", ") },
        { label: "Country", value: details.countries.join(", ") },
        { label: "Budget", value: money(details.budget) },
        { label: "Revenue", value: money(details.revenue) },
        {
            label: "Links",
            value: <span className="flex flex-wrap gap-3">
                <Link href={`https://www.themoviedb.org/${ media.type }/${ media.id }`}>TMDB</Link>
                {details.imdb_id && <Link href={`https://www.imdb.com/title/${ details.imdb_id }`}>IMDb</Link>}
                {details.homepage && <Link href={details.homepage}>Website</Link>}
            </span>
        }
    ];

    return <>
        <div className="relative">
            {media.backdrop_img && <Image
                src={media.backdrop_img}
                alt=""
                width={1920}
                height={1080}
                priority
                className="pointer-events-none absolute inset-x-0 top-0 h-[420px] w-full object-cover object-top opacity-40 md:h-[560px]"
                style={{
                    maskImage: "linear-gradient(to bottom, rgba(0,0,0,1), rgba(0,0,0,0))"
                }}
            />}

            {/* in normal flow so the page grows with the content; backdrop stays behind */}
            <div className="relative space-y-10 p-4 pb-12 md:p-8">
                <div className="flex flex-col gap-6 md:flex-row md:gap-8">
                    {media.poster_img
                        ? <Image
                            src={media.poster_img}
                            alt={media.name}
                            width={220}
                            height={330}
                            priority
                            className="w-[160px] shrink-0 rounded-lg shadow-lg md:w-[220px]"
                        />
                        : <div className="flex h-[240px] w-[160px] shrink-0 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground md:h-[330px] md:w-[220px]">
                            no poster
                        </div>}

                    <div className="min-w-0 flex-1 space-y-4 md:pt-6">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge>{ isTv ? "series" : "movie" }</Badge>
                            {details.certification && <Badge variant="outline">{ details.certification }</Badge>}
                            <WatchlistBadge entry={entry} />
                        </div>

                        <div className="space-y-1">
                            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                                { media.name }
                                {year && <span className="ml-2 text-2xl font-normal text-muted-foreground">({ year })</span>}
                            </h1>

                            {details.tagline && <p className="text-muted-foreground italic">{ details.tagline }</p>}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                            {details.votes > 0 && <span className="flex items-center gap-1 font-medium">
                                <Star className="size-4 fill-current text-amber-500" />
                                { details.rating.toFixed(1) }
                                <span className="text-muted-foreground">({ votes(details.votes) })</span>
                            </span>}

                            {details.runtime && <span className="text-muted-foreground">{ runtimeText(details.runtime, isTv) }</span>}

                            {details.genres.map(genre => (
                                <Badge key={genre.id} variant="secondary">{ genre.name }</Badge>
                            ))}
                        </div>

                        <p className="max-w-3xl text-sm leading-relaxed">{ media.overview || "No overview yet." }</p>

                        <div className="flex flex-wrap gap-3 pt-2">
                            <Button
                                className="cursor-pointer"
                                onClick={download}
                                disabled={isTv && pickedCount === 0}
                            >
                                <Download />
                                Download
                                { isTv && pickedCount > 0 ? ` ${ pickedCount } episode${ pickedCount > 1 ? "s" : "" }` : "" }
                            </Button>

                            {details.trailer && <Button
                                variant="secondary"
                                className="cursor-pointer"
                                onClick={() => setTrailerOpen(true)}
                            >
                                <Play /> Trailer
                            </Button>}

                            {entry?.monitored && <Button
                                variant="outline"
                                className="cursor-pointer"
                                onClick={() => remove(type, tmdbId, media.name)}
                            >
                                <BookmarkX /> Stop watching
                            </Button>}
                        </div>
                    </div>
                </div>

                {isTv && <div className="max-w-2xl">
                    <h3 className="text-lg font-semibold tracking-tight">Seasons</h3>
                    <p className="text-sm text-muted-foreground">
                        Tick what you want — a whole season or single episodes. Ticking puts it on your
                        watchlist right away, unticking takes it off.
                    </p>

                    <Separator className="my-3" />

                    <SeasonPicker
                        seasons={seasons}
                        item={item}
                        monitored={monitored}
                        onToggle={toggle}
                        disabled={isSaving}
                    />
                </div>}

                <CastRow title="Cast" people={details.cast} />

                <FactGrid facts={facts} />

                <MediaRow title="Recommendations" items={details.recommendations} />

                <MediaRow title="More like this" items={details.similar} />
            </div>
        </div>

        <TrailerDialog video={details.trailer} open={isTrailerOpen} onOpenChange={setTrailerOpen} />
    </>;
}
