import { NextRequest } from "next/server";
import { getDiscoverPage } from "@/lib/media";

export async function GET(req: NextRequest) {
    const params = req.nextUrl.searchParams;
    const requested = Number(params.get("page"));

    const found = await getDiscoverPage({
        type: params.get("type") || "all",
        category: params.get("category") || "trending",
        genre: params.get("genre"),
        page: Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1
    });

    return Response.json({
        success: true,
        result: found.results,
        page: found.page,
        totalPages: found.totalPages
    });
}
