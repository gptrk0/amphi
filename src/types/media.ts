export type Media = {
    id: number;
    type: "movie" | "tv";
    name: string;
    overview: string;
    date: string;
    poster_img: string;
    backdrop_img: string;
};

// original_name is kept separately because release names use the original title,
// which differs from the localised one when TMDB_LANGUAGE is not en-US.
export type MediaMetadata = {
    media: Media;
    original_name: string;
    // ISO 639-1, so that a release in the original language is never language filtered
    original_language: string | null;
    year: string | null;
};

export type MediaPage = {
    results: Media[];
    page: number;
    totalPages: number;
};

export type MediaGenre = {
    id: number;
    name: string;
};

export type MediaEpisode = {
    episode_number: number;
    name: string;
    overview: string;
    air_date: string | null;
};

export type MediaSeason = {
    season_number: number;
    name: string;
    episode_count: number;
    air_date: string | null;
    episodes: MediaEpisode[];
};
