import { NextRequest } from "next/server";
import { getSections, isSectionView } from "@/lib/sections";

export async function GET(req: NextRequest) {
    const view = req.nextUrl.searchParams.get("view") || "home";

    if (! isSectionView(view)) {
        return Response.json({ success: false, message: "Unknown view." }, { status: 400 });
    }

    const page = await getSections(view);

    return Response.json({ success: true, ...page });
}
