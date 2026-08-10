import { notFound } from "next/navigation";

import { getMediaDetails, getTvSeasons, isMediaType } from "@/lib/media";
import { DetailsView } from "@/components/details-view";
import { toSeasonInfo } from "@/types/media";

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
            // trimmed of the episode overviews, which are the bulk of the payload — the
            // same shape /api/seasons hands to the download dialog's own picker
            seasons={toSeasonInfo(seasons)}
        />
    );
}
