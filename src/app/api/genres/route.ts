import { NextRequest } from "next/server";
import { getGenres } from "@/lib/media";

export async function GET(req: NextRequest) {
    const genres = await getGenres(req.nextUrl.searchParams.get("type") || "");

    return Response.json({ success: true, result: genres });
}
