import { currentUser, refuseUnlessAdmin, withActor } from "@/lib/auth";
import { logInfo, logWarn } from "@/lib/log";
import {
    cancelDelete,
    deleteLibraryItem,
    getLibraryItem,
    isSeeding,
    keepDays,
    libraryLabel,
    MAX_KEEP_DAYS,
    minKeepDays,
    requestDelete,
    setKeepDays
} from "@/lib/library";
import { notify, notifyUsers } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

/**
 * Two decisions about one download: how long it is kept, and whether it is to be deleted
 * when the seed time is up. The second one is what the delete button becomes while the
 * seed time is still running — the row goes by itself the moment it is up.
 */
export async function PATCH(req: Request, { params }: Params) {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

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
        const who = await currentUser();
        const label = await libraryLabel(item);

        // how long it stays. `null` hands it back to the default for its shape; anything
        // else has to be inside the range the library offers — the api is the guard, not
        // the number input
        if (body?.keepDays !== undefined) {
            const wanted = body.keepDays === null ? null : Number(body.keepDays);
            const min = minKeepDays();

            if (wanted !== null && (! Number.isFinite(wanted) || wanted < min || wanted > MAX_KEEP_DAYS)) {
                return Response.json({
                    success: false,
                    message: `Keep it for between ${ min } and ${ MAX_KEEP_DAYS } days!`
                }, { status: 400 });
            }

            const result = await setKeepDays(itemId, wanted);

            await logInfo(
                "library",
                `kept for ${ keepDays(result) } days: ${ label }`,
                withActor(wanted === null ? "back to the default for its size" : undefined, who)
            );

            return Response.json({ success: true, result });
        }

        const wanted = body?.deleteRequested === true;

        const result = wanted ? await requestDelete(itemId, who?.id ?? null) : await cancelDelete(itemId);

        await logInfo(
            "library",
            wanted ? `marked for deletion: ${ label }` : `deletion cancelled: ${ label }`,
            withActor(wanted ? "it goes with its files when the seed time is up" : undefined, who)
        );

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to update the library item!' }, { status: 500 });
    }
}

/**
 * Delete now — the torrent and its files, always. Refused while the item is still seeding:
 * that is what the mark is for. Nothing about this can be undone.
 */
export async function DELETE(_req: Request, { params }: Params) {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

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

        if (isSeeding(item)) {
            return Response.json({
                success: false,
                seeding: true,
                message: 'This is still seeding — mark it for deletion instead.'
            }, { status: 409 });
        }

        const label = await libraryLabel(item);
        const who = await currentUser();

        await deleteLibraryItem(item);

        await logWarn(
            "library",
            `deleted: ${ label }`,
            withActor("the torrent and its files were removed from the client", who)
        );

        // the files are gone and everybody sharing this install is affected, so the
        // install chat hears it with a name on it. The people who were waiting for this
        // one hear it too — for them it is the download itself that disappeared
        const detail = `the torrent and its files were deleted${ item.releaseTitle ? ` — ${ item.releaseTitle }` : "" }`;

        await notify("deleted", label, detail, who ? `deleted by ${ who.name }` : "deleted by nobody signed in");
        await notifyUsers(item.watchedBy, "deleted", label, detail);

        return Response.json({ success: true });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to delete the library item!' }, { status: 500 });
    }
}
