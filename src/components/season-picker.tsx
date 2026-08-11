'use client';

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import classNames from "classnames";

import { Checkbox } from "@/components/ui/checkbox";
import { useLocale } from "@/context/locale";
import { MessageKey, Translate } from "@/i18n";
import { SeasonInfo } from "@/types/media";
import { WatchlistItem, WatchStatus } from "@/types/watchlist";

// it moved to the types, because a server route hands the same shape out now
export type { SeasonInfo };

type Props = {
    seasons: SeasonInfo[];
    item?: WatchlistItem;
    // "<season>:<episode>" keys, held by the page so the download button sees them
    monitored: Set<string>;
    onToggle: (seasonNumber: number, episodeNumbers: number[] | null, checked: boolean) => void;
    disabled?: boolean;
};

export const episodeKey = (seasonNumber: number, episodeNumber: number) => `${ seasonNumber }:${ episodeNumber }`;

// PENDING says nothing worth saying next to an episode: it is on the list and that is
// what the tick already shows
const statusText = (status: WatchStatus, t: Translate) => {
    return status === "PENDING" ? "" : t(`seasonPicker.status.${ status }` as MessageKey);
};

const aired = (airDate: string | null) => !! airDate && new Date(airDate).getTime() <= Date.now();

export function SeasonPicker({ seasons, item, monitored, onToggle, disabled }: Props) {
    const { t } = useLocale();

    const shortDate = (airDate: string | null) => airDate ? airDate.slice(0, 10) : t("seasonPicker.noDate");

    // null until the user opens or closes something; the watchlist decides until then
    const [ expanded, setExpanded ] = useState<number[] | null>(null);

    const watched = (season: SeasonInfo) => {
        return season.episodes.some(e => monitored.has(episodeKey(season.season_number, e.episode_number)));
    };

    // a season with anything on the watchlist starts open, so the state that is
    // already there is visible without a click
    const open = expanded ?? seasons.filter(watched).map(season => season.season_number);

    const statusOf = (seasonNumber: number, episodeNumber: number): WatchStatus | null => {
        const season = item?.seasons.find(s => s.seasonNumber === seasonNumber);

        return season?.episodes?.find(e => e.episodeNumber === episodeNumber)?.status || null;
    };

    const toggleExpanded = (seasonNumber: number) => {
        setExpanded(open.includes(seasonNumber)
            ? open.filter(v => v !== seasonNumber)
            : [ ...open, seasonNumber ]);
    };

    // freeze what is open first: otherwise unticking the last episode of a season
    // would fold it up under the cursor
    const toggle = (seasonNumber: number, episodeNumbers: number[] | null, checked: boolean) => {
        setExpanded(open);
        onToggle(seasonNumber, episodeNumbers, checked);
    };

    return (
        <div className="flex flex-col">
            {seasons.map(season => {
                const picked = season.episodes.filter(e => monitored.has(episodeKey(season.season_number, e.episode_number)));
                const state = picked.length === 0
                    ? false
                    : picked.length === season.episodes.length ? true : "indeterminate";

                const isOpen = open.includes(season.season_number);
                const downloaded = item?.seasons.find(s => s.seasonNumber === season.season_number)?.downloadedCount || 0;

                return (
                    <div key={season.season_number} className="border-b last:border-b-0">
                        <div className="flex items-center gap-3 py-2">
                            <Checkbox
                                className="cursor-pointer"
                                checked={state}
                                disabled={disabled || season.episodes.length === 0}
                                onCheckedChange={(checked) => toggle(season.season_number, null, checked === true)}
                            />

                            <button
                                type="button"
                                className="flex flex-1 cursor-pointer items-center gap-2 text-left"
                                onClick={() => toggleExpanded(season.season_number)}
                                disabled={season.episodes.length === 0}
                            >
                                {isOpen
                                    ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                                    : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}

                                <span className="text-sm">
                                    <span className="font-medium">{ season.name }</span>
                                    <span className="text-muted-foreground">
                                        { " — " }{ t("seasonPicker.episodes", { n: season.episode_count }) }
                                        { season.air_date ? ` (${ season.air_date.split("-")[0] })` : "" }
                                        { picked.length > 0 ? ` — ${ t("seasonPicker.watched", { n: picked.length }) }` : "" }
                                        { downloaded > 0 ? ` — ${ t("seasonPicker.downloaded", { n: downloaded }) }` : "" }
                                    </span>
                                </span>
                            </button>
                        </div>

                        {isOpen && <div className="flex flex-col pb-2 pl-7">
                            {season.episodes.map(episode => {
                                const status = statusOf(season.season_number, episode.episode_number);
                                const isAired = aired(episode.air_date);

                                return (
                                    <label
                                        key={episode.episode_number}
                                        className="flex cursor-pointer items-center gap-3 py-1"
                                    >
                                        <Checkbox
                                            className="cursor-pointer"
                                            checked={monitored.has(episodeKey(season.season_number, episode.episode_number))}
                                            disabled={disabled}
                                            onCheckedChange={(checked) => toggle(season.season_number, [ episode.episode_number ], checked === true)}
                                        />

                                        <span className={classNames("text-sm", { "text-muted-foreground": ! isAired })}>
                                            <span className="text-muted-foreground">
                                                { `E${ String(episode.episode_number).padStart(2, "0") } ` }
                                            </span>
                                            { episode.name }
                                            <span className="text-muted-foreground">
                                                { ` — ${ shortDate(episode.air_date) }` }
                                                { status && statusText(status, t) ? ` — ${ statusText(status, t) }` : "" }
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>}
                    </div>
                );
            })}
        </div>
    );
}
