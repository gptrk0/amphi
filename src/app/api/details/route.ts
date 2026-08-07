import { NextRequest } from "next/server";
import { getMediaDetails, getTvSeasons } from "@/lib/media";

export async function GET(req: NextRequest) {
    const type = req.nextUrl.searchParams.get('type');
    const id = Number(req.nextUrl.searchParams.get('id'));

    if (! type || ! id) {
        return Response.json({ success: false });
    }

    const details = await getMediaDetails(type, id);

    if (! details) {
        return Response.json({ success: false, message: "Failed to fetch details." });
    }

    const seasons = type === "tv" ? await getTvSeasons(id) : [];

    return Response.json({
        success: true,
        // the plain media object stays where it was, the page reads the rest from
        // `details`
        result: details.media,
        details,
        seasons: seasons.map(season => ({
            season_number: season.season_number,
            name: season.name,
            air_date: season.air_date,
            episode_count: season.episode_count,
            episodes: season.episodes.map(episode => ({
                episode_number: episode.episode_number,
                name: episode.name,
                air_date: episode.air_date
            }))
        }))
    });
}
