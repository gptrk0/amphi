import { currentUser, refuseUnlessAdmin, refuseUnlessSignedIn, withActor } from "@/lib/auth";
import { logInfo } from "@/lib/log";
import {
    getWatchlistItem,
    getWatchlistItemByTmdbId,
    setOwner,
    setRequestedLanguage,
    stopWatching,
    toMediaType
} from "@/lib/watchlist";
import { usersByIds } from "@/lib/users";
import { resolveLanguage } from "@/types/language";

type Params = { params: Promise<{ id: string }> };

/**
 * Two things about one row: the language it is wanted in, and whose want it is.
 *
 * The language is the owner's answer to "what do you want", so the owner sets it, plus an
 * administrator, who is already the one person who can take a row off somebody else's list.
 * The owner is a different matter and is administrators only — see `setOwner`.
 */
export async function PATCH(req: Request, { params }: Params) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const { id } = await params;
    const watchlistId = Number(id);
    const me = (await currentUser())!;

    if (! watchlistId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    try {
        const body = await req.json().catch(() => null);
        const item = await getWatchlistItem(watchlistId);

        if (! item || (item.userId !== me.id && ! me.isAdmin)) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        // whose list this row is on. It is the whole row that moves, off one person and
        // onto another, so neither of them can be the one asking for it
        if (body?.userId !== undefined) {
            const forbidden = await refuseUnlessAdmin();

            if (forbidden) {
                return forbidden;
            }

            const userId = Number(body.userId);

            if (! Number.isInteger(userId) || userId <= 0) {
                return Response.json({ success: false, message: 'Invalid user id!' }, { status: 400 });
            }

            const [ target ] = await usersByIds([ userId ]);

            if (! target) {
                return Response.json({ success: false, message: 'That account does not exist.' }, { status: 400 });
            }

            // one row per person per title, and merging two of them is not a thing this
            // app can decide: they have their own units, their own history and their own
            // language. So the answer is that there is nothing to move it to
            const clash = await getWatchlistItemByTmdbId(userId, item.tmdbId, item.type);

            if (clash && clash.id !== item.id) {
                return Response.json({
                    success: false,
                    // the caller words this one itself, in the reader's language
                    conflict: true,
                    message: `${ target.name } already has this on their watchlist.`
                }, { status: 409 });
            }

            const result = await setOwner(watchlistId, userId);
            const name = result?.media?.name || `TMDB #${ item.tmdbId }`;

            await logInfo(
                "watchlist",
                `${ name } is on ${ target.name }'s watchlist now`,
                withActor(
                    item.userId === userId ? "it already was" : `off ${ item.user.name }'s list, with everything still to be found on it`,
                    me
                )
            );

            return Response.json({ success: true, result });
        }

        if (typeof body?.language !== "string") {
            return Response.json({ success: false, message: 'Nothing to change.' }, { status: 400 });
        }

        const asked = body.language.trim();
        // the same catalogue the form offers, and forgiving in the one direction that
        // costs nothing: `hungarian`, `magyar` and `hu` all arrive as `hun`
        const language = asked ? resolveLanguage(asked) : "";

        if (asked && ! language) {
            return Response.json({
                success: false,
                message: `"${ asked }" is not a language this app knows.`
            }, { status: 400 });
        }

        const result = await setRequestedLanguage(watchlistId, language || "");
        const name = result?.media?.name || `TMDB #${ item.tmdbId }`;

        await logInfo(
            "watchlist",
            language
                ? `${ name } is wanted in ${ language }`
                : `${ name } follows the account's languages again`,
            withActor(
                [
                    `searching in ${ (result?.searchLanguages || []).join("/") || "nothing" } from now on`,
                    item.userId === me.id ? "" : `on ${ item.user.name }'s list`
                ].filter(Boolean).join(", "),
                me
            )
        );

        return Response.json({ success: true, result });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to change the language!' }, { status: 500 });
    }
}

/**
 * Stop watching, which is all a watchlist row can be asked to do now: it holds what
 * is still to be found, nothing else. Deleting files is a library action, on the
 * download that brought them.
 *
 * A row belongs to somebody, and only they can take it off — plus an administrator,
 * who is the one person who can clear up after somebody who left. Deleting files is
 * a library action, and that one is administrators only for everybody.
 */
export async function DELETE(req: Request, { params }: Params) {
    const refusal = await refuseUnlessSignedIn();

    if (refusal) {
        return refusal;
    }

    const { id } = await params;
    const watchlistId = Number(id);
    const me = (await currentUser())!;

    if (! watchlistId) {
        return Response.json({ success: false, message: 'Invalid id!' }, { status: 400 });
    }

    try {
        const item = await getWatchlistItem(watchlistId);

        if (! item) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        // 404 and not 403: whether somebody else is watching something is not this
        // endpoint's to tell
        if (item.userId !== me.id && ! me.isAdmin) {
            return Response.json({ success: false, message: 'Watchlist item not found!' }, { status: 404 });
        }

        const result = await stopWatching(watchlistId);
        const name = result?.media?.name || `TMDB #${ item.tmdbId }`;

        await logInfo(
            "watchlist",
            `stopped watching: ${ name }`,
            withActor(
                [
                    result ? "some of it is still watched" : "nothing is left to look for, so it came off the watchlist",
                    item.userId === me.id ? "" : `off ${ item.user.name }'s list`
                ].filter(Boolean).join(", "),
                me
            )
        );

        // no title is stored, the caller renders the message from what it already knows
        return Response.json({
            success: true,
            kept: !! result,
            result: { id: item.id, tmdbId: item.tmdbId, type: toMediaType(item.type) }
        });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: 'Failed to remove from watchlist!' }, { status: 500 });
    }
}
