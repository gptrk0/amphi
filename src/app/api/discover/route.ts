import { NextRequest } from "next/server";
import axios from "axios";
import { isMediaType, toMedia } from "@/lib/media";
import { Media } from "@/types/media";

export async function GET(req: NextRequest) {
    const type = req.nextUrl.searchParams.get('type');
    const time_window = req.nextUrl.searchParams.get('time_window');
    const pages = 3;

    let result: Media[][] = [];

    for (let i = 1; i <= pages; i++) {
        try {
            const res = await axios.get(`https://api.themoviedb.org/3/trending/${ type }/${ time_window }`, {
                params: {
                    api_key: process.env.TMDB_API_KEY,
                    language: process.env.TMDB_LANGUAGE || "en-US",
                    page: i
                }
            });

            const medias: Media[] = (res.data.results || [])
                .filter((v: any) => isMediaType(v.media_type))
                .map((v: any) => toMedia(v, v.media_type));

            result.push(medias);

        } catch(err) {
            console.error(err);
        }
    }
   
    return Response.json({ success: true, result });
}
