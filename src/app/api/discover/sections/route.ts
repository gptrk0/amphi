import { NextRequest } from "next/server";
import { getSections, isSectionView } from "@/lib/sections";
import { isTmdbConfigured } from "@/lib/media";
import { loadSettings } from "@/lib/settings";
import { refuseUnlessSignedIn } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const view = req.nextUrl.searchParams.get("view") || "home";

    if (! isSectionView(view)) {
        return Response.json({ success: false, message: "Unknown view." }, { status: 400 });
    }

    const page = await getSections(view);

    await loadSettings();

    // with no api key every row comes back empty, and an empty page looks like a broken
    // one — so the reason travels with it
    return Response.json({ success: true, ...page, setup: { tmdb: isTmdbConfigured() } });
}
