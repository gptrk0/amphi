/**
 * What a torrent actually contains, as opposed to what its name claims. The indexer
 * only offers a title, and a fake release copies a real one perfectly — the payload
 * is where it gives itself away. The Silo S03E07 grab of 2026-08-08 was a single
 * 1.2 GB `Silo S03E07 MULTI 1080p WEB H264-HiggsBoson.scr`: a Windows executable
 * padded up to a believable episode size, with a name that passed every check the
 * scoring could make.
 *
 * The extension lists are settings, and two of their edge cases matter here:
 *
 * - **An empty list rejects nothing.** A missing configuration is not evidence that a
 *   download is bad, and treating it as such would delete every torrent.
 * - **`*` accepts everything**, so it is the way to switch a single rule off without
 *   emptying the list you would want back later.
 */

import { settingFlag, settingList } from "@/lib/settings";

export type TorrentFile = { name: string, size: number };

export type PayloadProfile = {
    video: string[];
    archive: string[];
    executable: string[];
};

const ACCEPT_ALL = "*";

// `.r00`-`.r99` continue a `.rar`, so they follow whatever the archive list says
// about `rar` instead of being listed one by one
const RAR_PART = /^r\d{2}$/;

// the deletion is a real one, but a payload like this is not worth keeping
export const payloadDeleteFiles = () => settingFlag("PAYLOAD_DELETE_FILES");

// a leading dot is the natural way to write these, in an env file or in a form field
const clean = (values: string[]) => values.map(v => v.toLowerCase().replace(/^\.+/, "")).filter(Boolean);

export const getPayloadProfile = (): PayloadProfile => {
    return {
        video: clean(settingList("PAYLOAD_VIDEO_EXTENSIONS")),
        archive: clean(settingList("PAYLOAD_ARCHIVE_EXTENSIONS")),
        executable: clean(settingList("PAYLOAD_EXECUTABLE_EXTENSIONS"))
    };
};

const acceptsAll = (extensions: string[]) => extensions.includes(ACCEPT_ALL);

/** A list only rejects when it has something to say and is not set to accept all. */
const rejects = (extensions: string[]) => extensions.length > 0 && ! acceptsAll(extensions);

/**
 * Whether the check can reject anything at all. The scheduler says so at startup: a
 * safety net that quietly does nothing is worse than not having one.
 */
export const isPayloadCheckConfigured = (profile = getPayloadProfile()) => {
    return rejects(profile.executable) || rejects(profile.video);
};

// qBittorrent marks a file that is still downloading with its own suffix
const extensionOf = (name: string) => {
    const clean = name.replace(/\.!qB$/i, "");
    const dot = clean.lastIndexOf(".");

    return dot < 0 ? "" : clean.slice(dot + 1).toLowerCase();
};

// torrents padded to align their pieces carry filler entries that are not content
const isPadding = (name: string) => name.includes(".pad/") || /_____padding_file/i.test(name);

export type PayloadVerdict = { bad: boolean, reason: string };

/**
 * Only a clear case is called bad. A magnet whose metadata has not arrived has no
 * files to judge yet, and an archived release cannot be judged from here at all —
 * both come back clean, and the stall clock is what catches them if they go nowhere.
 */
export const inspectPayload = (files: TorrentFile[], profile = getPayloadProfile()): PayloadVerdict => {
    const real = files.filter(file => ! isPadding(file.name));

    if (real.length === 0) {
        return { bad: false, reason: "" };
    }

    if (rejects(profile.executable)) {
        // the trick is a real but tiny sample next to the payload, so the biggest
        // file is the one that decides what this torrent is
        const largest = real.reduce((max, file) => file.size > max.size ? file : max, real[0]);
        const largestExtension = extensionOf(largest.name);

        if (profile.executable.includes(largestExtension)) {
            return { bad: true, reason: `its largest file is a .${ largestExtension }` };
        }
    }

    // without a list of video extensions there is no notion of "no video in it"
    if (rejects(profile.video)) {
        const hasVideo = real.some(file => profile.video.includes(extensionOf(file.name)));

        const hasArchive = acceptsAll(profile.archive) || real.some(file => {
            const extension = extensionOf(file.name);

            return profile.archive.includes(extension)
                || (profile.archive.includes("rar") && RAR_PART.test(extension));
        });

        if (! hasVideo && ! hasArchive) {
            return { bad: true, reason: "there is no video file in it" };
        }
    }

    return { bad: false, reason: "" };
};
