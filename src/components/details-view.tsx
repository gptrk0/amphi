'use client';

import { useEffect, useState } from "react";
import Image from "next/image";
import NextLink from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { BookmarkX, Download, ExternalLink, Play, Star } from "lucide-react";

import { MediaDetails, MediaPerson } from "@/types/media";
import { WatchlistItem } from "@/types/watchlist";
import { useDownload } from "@/context/download";
import { useLocale } from "@/context/locale";
import { useWatchlist } from "@/context/watchlist";
import { Locale, Translate } from "@/i18n";
import { CastRow } from "@/components/cast-row";
import { Fact, FactGrid } from "@/components/fact-grid";
import { MediaRow } from "@/components/media-row";
import { TrailerDialog } from "@/components/trailer-dialog";
import { WatchlistBadge } from "@/components/watchlist-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { episodeKey, SeasonInfo, SeasonPicker } from "@/components/season-picker";

// every one of these takes the translator rather than reaching for a global: they are
// module level, and a language is a property of the render, not of the module
const runtimeText = (minutes: number | null, isTv: boolean, t: Translate) => {
    if (! minutes) {
        return "";
    }

    if (isTv) {
        return t("details.facts.perEpisode", { n: minutes });
    }

    const hours = Math.floor(minutes / 60);

    return hours > 0
        ? t("details.facts.hoursMinutes", { h: hours, m: minutes % 60 })
        : t("details.facts.minutes", { m: minutes });
};

const money = (value: number, locale: Locale, t: Translate) => {
    if (! value) {
        return "";
    }

    if (value >= 1000000000) {
        return t("details.facts.billions", { n: (value / 1000000000).toFixed(1) });
    }

    if (value >= 1000000) {
        return t("details.facts.millions", { n: Math.round(value / 1000000) });
    }

    return t("details.facts.dollars", { n: value.toLocaleString(dateLocale(locale)) });
};

const votes = (value: number) => {
    return value >= 1000 ? `${ (value / 1000).toFixed(1) }k` : String(value);
};

// a Hungarian page writes "2026. aug. 11.", an English one "11 Aug 2026" — the same date
// formatted by whoever is reading it
const dateLocale = (locale: Locale) => locale === "hu" ? "hu-HU" : "en-GB";

const dateText = (value: string | null | undefined, locale: Locale) => {
    if (! value) {
        return "";
    }

    return new Date(value).toLocaleDateString(dateLocale(locale), { year: "numeric", month: "short", day: "numeric" });
};

/**
 * "Director: David Fincher" rather than a list of names with jobs repeated: one
 * line per job, however many people share it.
 *
 * The names are links, like the faces in the cast row are — the person page does not care
 * which side of the camera somebody was on, and a director is exactly who you want to look
 * up from here.
 */
const crewFacts = (crew: MediaPerson[]): Fact[] => {
    const byJob = new Map<string, MediaPerson[]>();

    for (const person of crew) {
        for (const job of person.role.split(", ")) {
            byJob.set(job, [ ...(byJob.get(job) || []), person ]);
        }
    }

    return [ ...byJob.entries() ].map(([ job, people ]) => ({
        label: job,
        value: <span>
            {people.map((person, index) => (
                <span key={person.id}>
                    {index > 0 && ", "}

                    <NextLink href={`/person/${ person.id }`} className="hover:underline">
                        { person.name }
                    </NextLink>
                </span>
            ))}
        </span>
    }));
};

/**
 * A way off this page, and one of the things people actually came for — so it looks like
 * something to press rather than the last line of a table of facts. Every one of them
 * leaves the app, hence the icon on all of them and `noreferrer`.
 */
const LinkButton = ({ href, children }: { href: string, children: React.ReactNode }) => (
    <Button variant="outline" className="cursor-pointer" asChild>
        <a href={href} target="_blank" rel="noreferrer">
            { children } <ExternalLink className="size-3.5 text-muted-foreground" />
        </a>
    </Button>
);

type Props = {
    type: string;
    tmdbId: number;
    details: MediaDetails;
    seasons: SeasonInfo[];
};

export function DetailsView({ type, tmdbId, details, seasons }: Props) {
    const { locale, t } = useLocale();
    const [item, setItem] = useState<WatchlistItem>();
    // "<season>:<episode>" keys — the watchlist state, mirrored so a tick is instant
    const [monitored, setMonitored] = useState<Set<string>>(new Set());
    const [isSaving, setSaving] = useState(false);
    const [isTrailerOpen, setTrailerOpen] = useState(false);

    const { getEntry, remove, refresh } = useWatchlist();
    const { startDownload } = useDownload();
    const entry = getEntry(type, tmdbId);

    // Per episode ticks and states, from both tables at once — asked for by title
    // rather than by watchlist id, because a show whose episodes are all downloaded
    // has no watchlist row left and still has to draw as downloaded.
    useEffect(() => {
        if (! entry) {
            setItem(undefined);
            return;
        }

        axios.get("/api/watchlist", { params: { type, tmdbId } })
            .then(res => setItem(res.data.result))
            .catch(err => console.error(err));
        // the whole entry, not its id: a finished download replaces it and the
        // episode states below have to follow
    }, [ entry, type, tmdbId ])

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
            toast(t("details.updateFailed"));

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
        // `details.status` is TMDB's own word ("Returning Series") and stays as it is: it
        // is what TMDB says about the show, not something this app has an opinion on
        { label: t("details.facts.status"), value: details.status },
        ...(details.next_episode ? [ {
            label: t("details.facts.nextEpisode"),
            value: `S${ String(details.next_episode.season_number).padStart(2, "0") }E${ String(details.next_episode.episode_number).padStart(2, "0") } · ${ dateText(details.next_episode.air_date, locale) || t("details.facts.dateUnknown") }`
        } ] : []),
        ...crewFacts(details.crew),
        { label: isTv ? t("details.facts.firstAired") : t("details.facts.released"), value: dateText(media.date, locale) },
        ...(isTv ? [ { label: t("details.facts.lastAired"), value: dateText(details.last_air_date, locale) } ] : []),
        ...(isTv ? [ {
            label: t("details.facts.episodes"),
            value: t(details.season_count === 1 ? "details.facts.oneSeason" : "details.facts.seasonCount", {
                seasons: details.season_count ?? 0,
                episodes: details.episode_count ?? 0
            })
        } ] : []),
        { label: t("details.facts.runtime"), value: runtimeText(details.runtime, isTv, t) },
        { label: t("details.facts.originalTitle"), value: details.original_name !== media.name ? details.original_name : "" },
        { label: t("details.facts.originalLanguage"), value: details.original_language ? details.original_language.toUpperCase() : "" },
        { label: t("details.facts.spokenLanguages"), value: details.languages.join(", ") },
        ...(isTv ? [ { label: t("details.facts.network"), value: details.networks.map(network => network.name).join(", ") } ] : []),
        { label: t("details.facts.studio"), value: details.companies.slice(0, 3).map(company => company.name).join(", ") },
        { label: t("details.facts.country"), value: details.countries.join(", ") },
        { label: t("details.facts.budget"), value: money(details.budget, locale, t) },
        { label: t("details.facts.revenue"), value: money(details.revenue, locale, t) }
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
                            { t("details.noPoster") }
                        </div>}

                    <div className="min-w-0 flex-1 space-y-4 md:pt-6">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge>{ isTv ? t("details.series") : t("details.movie") }</Badge>
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

                            {details.runtime && <span className="text-muted-foreground">{ runtimeText(details.runtime, isTv, t) }</span>}

                            {details.genres.map(genre => (
                                <Badge key={genre.id} variant="secondary">{ genre.name }</Badge>
                            ))}
                        </div>

                        <p className="max-w-3xl text-sm leading-relaxed">{ media.overview || t("details.noOverview") }</p>

                        <div className="flex flex-wrap gap-3 pt-2">
                            {/* not disabled with nothing ticked any more: it asks instead,
                                in the same dialog a poster or the billboard now opens */}
                            <Button className="cursor-pointer" onClick={download}>
                                <Download />
                                { isTv && pickedCount > 0
                                    ? t(pickedCount === 1 ? "details.downloadEpisode" : "details.downloadEpisodes", { n: pickedCount })
                                    : t("details.download") }
                            </Button>

                            {details.trailer && <Button
                                variant="secondary"
                                className="cursor-pointer"
                                onClick={() => setTrailerOpen(true)}
                            >
                                <Play /> { t("details.trailer") }
                            </Button>}

                            {entry?.monitored && <Button
                                variant="outline"
                                className="cursor-pointer"
                                onClick={() => remove(type, tmdbId, media.name)}
                            >
                                <BookmarkX /> { t("details.stopWatching") }
                            </Button>}
                        </div>
                    </div>
                </div>

                {isTv && <div className="max-w-2xl">
                    <h3 className="text-lg font-semibold tracking-tight">{ t("details.seasons.title") }</h3>
                    <p className="text-sm text-muted-foreground">{ t("details.seasons.hint") }</p>

                    <Separator className="my-3" />

                    <SeasonPicker
                        seasons={seasons}
                        item={item}
                        monitored={monitored}
                        onToggle={toggle}
                        disabled={isSaving}
                    />
                </div>}

                <CastRow title={t("details.cast")} people={details.cast} />

                {/* a section of its own, above the facts rather than the last row inside
                    them: "where else can I read about this" is a question people come here
                    with, and it was answered in the smallest text on the page */}
                <div className="space-y-3">
                    <h3 className="text-lg font-semibold tracking-tight">{ t("details.links.title") }</h3>

                    <div className="flex flex-wrap gap-3">
                        <LinkButton href={`https://www.themoviedb.org/${ media.type }/${ media.id }`}>TMDB</LinkButton>
                        {details.imdb_id && <LinkButton href={`https://www.imdb.com/title/${ details.imdb_id }`}>IMDb</LinkButton>}
                        {details.homepage && <LinkButton href={details.homepage}>{ t("details.links.website") }</LinkButton>}
                    </div>
                </div>

                <FactGrid title={t("details.factsTitle")} facts={facts} />

                <MediaRow title={t("details.recommendations")} items={details.recommendations} />

                <MediaRow title={t("details.similar")} items={details.similar} />
            </div>
        </div>

        <TrailerDialog video={details.trailer} open={isTrailerOpen} onOpenChange={setTrailerOpen} />
    </>;
}
