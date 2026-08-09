import { NextRequest } from "next/server";

import { logInfo, logWarn } from "@/lib/log";
import {
    cancelDelete,
    deleteLibraryItem,
    getLibraryItem,
    isSeeding,
    libraryLabel,
    requestDelete
} from "@/lib/library";

type Params = { params: Promise<{ id: string }> };

/**
 * Marking for deletion and taking the mark back. This is what the delete button
 * becomes while the seed time is still running — the row goes by itself the moment
 * it is up.
 */
export async function PATCH(req: Request, { params }: Params) {
    const { id } = await params;
    const itemId = Number(id);

    if (! itemId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    try {
        const item = await getLibraryItem(itemId);

        if (! item) {
            return Response.json({ success: false, message: 'Library item not found!' }, { status: 404 });
        }

        const body = await req.json();
        const wanted = body?.deleteRequested === true;
        const withFiles = body?.deleteFiles !== false;

        const result = wanted ? await requestDelete(itemId, withFiles) : await cancelDelete(itemId);
        const label = await libraryLabel(item);

        await logInfo(
            "library",
            wanted ? `marked for deletion: ${ label }` : `deletion cancelled: ${ label }`,
            wanted
                ? `it goes ${ withFiles ? "with its files " : "" }when the seed time is up`
                : undefined
        );

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to update the library item!' }, { status: 500 });
    }
}

/**
 * Delete now. Refused while the item is still seeding — that is what the mark is
 * for. `files=1` takes the files as well, and nothing about that can be undone.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
    const { id } = await params;
    const itemId = Number(id);

    if (! itemId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    const withFiles = req.nextUrl.searchParams.get('files') === "1";

    try {
        const item = await getLibraryItem(itemId);

        if (! item) {
            return Response.json({ success: false, message: 'Library item not found!' }, { status: 404 });
        }

        if (isSeeding(item)) {
            return Response.json({
                success: false,
                seeding: true,
                message: 'This is still seeding — mark it for deletion instead.'
            }, { status: 409 });
        }

        const label = await libraryLabel(item);

        await deleteLibraryItem(item, withFiles);

        await logWarn(
            "library",
            `deleted: ${ label }`,
            withFiles ? "the torrent and its files were removed from the client" : "the torrent was removed, the files were kept"
        );

        return Response.json({ success: true });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to delete the library item!' }, { status: 500 });
    }
}
