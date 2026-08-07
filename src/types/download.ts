export type MissingSeason = {
    seasonNumber: number;
    episodeNumbers: number[];
};

/**
 * One release the user can pick. The guid identifies it inside the stored plan, so
 * the download link itself never travels to the browser and back.
 */
export type GrabOption = {
    guid: string;
    title: string;
    size: number;
    seeders: number;
    resolution: string | null;
    indexer: string;
};

/**
 * One line of the download dialog: a movie, a season pack or a single episode,
 * with the releases found for it. The first option is what the quality profile
 * would have taken on its own.
 */
export type GrabChoice = {
    key: string;
    label: string;
    seasonNumber: number | null;
    episodeNumbers: number[];
    isPack: boolean;
    options: GrabOption[];
    // how many releases the quality profile threw away for this line
    filtered: number;
};

export type DownloadPreview = {
    planId: string;
    type: "movie" | "tv";
    tmdbId: number;
    choices: GrabChoice[];
    missing: MissingSeason[];
    missingMovie: boolean;
    // every release the quality profile threw away, over the whole request
    filtered: number;
};
