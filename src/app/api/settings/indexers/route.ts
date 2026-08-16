import { refuseUnlessAdmin } from "@/lib/auth";
import { isIndexerConfigured, listIndexers } from "@/lib/indexer";
import { hasSetting, loadSettings } from "@/lib/settings";

/**
 * What the indexer manager says it has, for the button next to `INDEXER_IDS`.
 *
 * Administrators only, like the page it serves: it makes the server call an address of
 * somebody's choosing, which is the same thing the rest of this group already does — but
 * only for the people allowed to choose that address.
 *
 * It reads the **saved** url and key, not whatever is in the form. Sending unsaved values
 * here would let this route reach an address nothing has recorded, and the answer would be
 * about a configuration the app is not running with. The page knows this and says "save
 * first" rather than letting the call fail.
 */
export async function GET() {
    const refusal = await refuseUnlessAdmin();

    if (refusal) {
        return refusal;
    }

    try {
        await loadSettings(true);

        // the two settings this cannot work without, named one by one — "it failed" would
        // send somebody looking at Jackett for a value that was never filled in here
        if (! isIndexerConfigured()) {
            return Response.json({ success: false, message: "Fill in the Jackett / Prowlarr URL first." }, { status: 400 });
        }

        if (! hasSetting("INDEXER_API_KEY")) {
            return Response.json({ success: false, message: "Fill in the indexer API key first." }, { status: 400 });
        }

        const { indexers, error } = await listIndexers();

        if (error) {
            return Response.json({ success: false, message: `The indexer manager answered: ${ error }` }, { status: 502 });
        }

        return Response.json({ success: true, indexers });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Could not read the indexer list." }, { status: 500 });
    }
}
