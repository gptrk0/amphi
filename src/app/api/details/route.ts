import { NextRequest } from "next/server";
import { fetchMediaDetails, getTvSeasons } from "@/lib/media";

export async function GET(req: NextRequest) {
    const type = req.nextUrl.searchParams.get('type');
    const id = req.nextUrl.searchParams.get('id');

    if (! type || ! id) {
        return Response.json({ success: false });
    }

    let media = await fetchMediaDetails(type as string, parseInt(id));

    if (! media) {
        return Response.json({ success: false, message: "Failed to fetch details." });
    }

    let seasons = type === "tv" ? await getTvSeasons(parseInt(id)) : [];

    return Response.json({
        success: true,
        result: media,
        seasons: seasons.map(s => {
            return {
                season_number: s.season_number,
                name: s.name,
                air_date: s.air_date,
                episode_count: s.episode_count,
                episodes: s.episodes.map(e => {
                    return {
                        episode_number: e.episode_number,
                        name: e.name,
                        air_date: e.air_date
                    };
                })
            };
        })
    });
}
