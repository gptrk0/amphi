import { notFound } from "next/navigation";

import { getMediaDetails, getTvSeasons, isMediaType } from "@/lib/media";
import { DetailsView } from "@/components/details-view";

/**
 * Server rendered on purpose: the page used to load its own data from /api/details
 * after its javascript arrived, which is three waits stacked on top of each other
 * before anything is on screen. Both calls read the same cache the api route did.
 */
export default async function Page({ params }: { params: Promise<{ type: string, id: string }> }) {
    const { type, id } = await params;
    const tmdbId = Number(id);

    if (! isMediaType(type) || ! tmdbId) {
        notFound();
    }

    const details = await getMediaDetails(type, tmdbId);

    if (! details) {
        notFound();
    }

    const seasons = type === "tv" ? await getTvSeasons(tmdbId) : [];

    return (
        <DetailsView
            type={type}
            tmdbId={tmdbId}
            details={details}
            // episode overviews are not shown here, and they are the bulk of the payload
            seasons={seasons.map(season => ({
                season_number: season.season_number,
                name: season.name,
                air_date: season.air_date,
                episode_count: season.episode_count,
                episodes: season.episodes.map(episode => ({
                    episode_number: episode.episode_number,
                    name: episode.name,
                    air_date: episode.air_date
                }))
            }))}
        />
    );
}
