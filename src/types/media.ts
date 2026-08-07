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

export type MediaPerson = {
    id: number;
    name: string;
    // the character for the cast, the job for the crew
    role: string;
    profile_img: string;
};

export type MediaCompany = {
    id: number;
    name: string;
    logo_img: string;
};

export type MediaVideo = {
    key: string;
    name: string;
};

export type MediaEpisodeStub = {
    name: string;
    air_date: string | null;
    season_number: number;
    episode_number: number;
};

/**
 * Everything the detail page shows. One TMDB request with the extras appended, so
 * a page is a single round trip.
 */
export type MediaDetails = {
    media: Media;
    original_name: string;
    original_language: string | null;
    tagline: string;
    status: string;
    // minutes: the running time of a film, the length of an episode for a show
    runtime: number | null;
    genres: MediaGenre[];
    rating: number;
    votes: number;
    certification: string | null;
    homepage: string;
    imdb_id: string | null;
    budget: number;
    revenue: number;
    companies: MediaCompany[];
    countries: string[];
    languages: string[];
    cast: MediaPerson[];
    crew: MediaPerson[];
    trailer: MediaVideo | null;
    recommendations: Media[];
    similar: Media[];
    // shows only
    season_count: number | null;
    episode_count: number | null;
    networks: MediaCompany[];
    first_air_date: string | null;
    last_air_date: string | null;
    in_production: boolean | null;
    next_episode: MediaEpisodeStub | null;
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
