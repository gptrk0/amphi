import { NextRequest } from "next/server";
import { refuseUnlessSignedIn } from "@/lib/auth";
import { searchMedia } from "@/lib/media";

export async function GET(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const query = (req.nextUrl.searchParams.get("q") || "").trim();
    const requested = Number(req.nextUrl.searchParams.get("page"));
    const page = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1;

    if (! query) {
        return Response.json({ success: true, result: [], page: 1, totalPages: 0 });
    }

    const found = await searchMedia(query, page);

    return Response.json({
        success: true,
        result: found.results,
        page: found.page,
        totalPages: found.totalPages
    });
}
