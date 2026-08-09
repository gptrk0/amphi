import { NextRequest } from "next/server";
import { refuseUnlessSignedIn } from "@/lib/auth";
import { getGenres } from "@/lib/media";

export async function GET(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const genres = await getGenres(req.nextUrl.searchParams.get("type") || "");

    return Response.json({ success: true, result: genres });
}
