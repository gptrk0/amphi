import { getDiscoverPage } from "@/lib/media";
import { getWatchlistWithMedia } from "@/lib/watchlist";
import { Media } from "@/types/media";
import { WatchStatus } from "@/types/watchlist";

export type Section = {
    key: string;
    title: string;
    description: string;
    href: string | null;
    items: Media[];
};

export type SectionsPage = {
    hero: Media | null;
    sections: Section[];
};

const ROW_SIZE = 20;

// Two pages per source, so a row stays full even after the rows above claim titles.
const PAGES_PER_ROW = 2;

type Source = {
    key: string;
    title: string;
    description: string;
    type: string;
    category: string;
    href: string | null;
};

/**
 * Row order is also the deduplication order: what an earlier row shows is not
 * repeated further down. Measured on the live api, the six original home rows
 * filled 120 slots with only 85 distinct titles — `now_playing` alone repeated
 * 15 of the 20 `popular` movies, which is why it is not a row anywhere.
 */
const VIEWS: Record<string, { personal: boolean, sources: Source[] }> = {
    home: {
        personal: true,
        sources: [
            { key: "trending", title: "Trending today", description: "What everyone is watching right now.", type: "all", category: "trending", href: null },
            { key: "popular-movies", title: "Popular movies", description: "Most watched films at the moment.", type: "movie", category: "popular", href: "/movies" },
            { key: "popular-series", title: "Popular series", description: "Most watched shows at the moment.", type: "tv", category: "popular", href: "/series" },
            { key: "on-the-air", title: "On the air", description: "Shows with new episodes this week.", type: "tv", category: "on_the_air", href: "/series" },
            { key: "upcoming-movies", title: "Coming soon", description: "Films that are not out yet.", type: "movie", category: "upcoming", href: "/movies" },
            { key: "top-rated-movies", title: "All time favourites", description: "The highest rated films on TMDB.", type: "movie", category: "top_rated", href: "/movies" }
        ]
    },
    movies: {
        personal: false,
        sources: [
            { key: "trending", title: "Trending today", description: "What everyone is watching right now.", type: "movie", category: "trending", href: null },
            { key: "popular", title: "Popular", description: "Most watched films at the moment.", type: "movie", category: "popular", href: null },
            { key: "upcoming", title: "Coming soon", description: "Films that are not out yet.", type: "movie", category: "upcoming", href: null },
            { key: "top-rated", title: "All time favourites", description: "The highest rated films on TMDB.", type: "movie", category: "top_rated", href: null }
        ]
    },
    series: {
        personal: false,
        sources: [
            { key: "trending", title: "Trending today", description: "What everyone is watching right now.", type: "tv", category: "trending", href: null },
            { key: "popular", title: "Popular", description: "Most watched shows at the moment.", type: "tv", category: "popular", href: null },
            { key: "airing-today", title: "Airing today", description: "Episodes landing today.", type: "tv", category: "airing_today", href: null },
            { key: "on-the-air", title: "On the air", description: "Shows with new episodes this week.", type: "tv", category: "on_the_air", href: null },
            { key: "top-rated", title: "All time favourites", description: "The highest rated shows on TMDB.", type: "tv", category: "top_rated", href: null }
        ]
    }
};

// The library rows go first, the same way Overseerr opens with the server's own
// content: they never overlap the catalog rows, and they push what is already
// in progress to the top.
const PERSONAL: { key: string, title: string, description: string, href: string, statuses: WatchStatus[] }[] = [
    {
        key: "downloading",
        title: "Downloading now",
        description: "Already on the way to your client.",
        href: "/watchlist",
        statuses: [ "DOWNLOADING" ]
    },
    {
        key: "downloaded",
        title: "Ready to watch",
        description: "Finished downloads.",
        href: "/watchlist/downloaded",
        statuses: [ "DOWNLOADED" ]
    },
    {
        key: "watchlisted",
        title: "On your watchlist",
        description: "Waiting for a release to show up.",
        href: "/watchlist",
        statuses: [ "PENDING", "SEARCHING", "FAILED" ]
    }
];

export const isSectionView = (view: string) => Object.keys(VIEWS).includes(view);

const mediaKey = (media: Media) => `${ media.type }-${ media.id }`;

export const getSections = async (view: string): Promise<SectionsPage> => {
    const config = VIEWS[view] || VIEWS.home;

    const [ watchlist, catalog ] = await Promise.all([
        config.personal
            ? getWatchlistWithMedia().catch(err => {
                console.error(err);

                return [];
            })
            : Promise.resolve([]),
        Promise.all(config.sources.map(async source => {
            const pages = await Promise.all(
                Array.from({ length: PAGES_PER_ROW }, (_, i) => getDiscoverPage({
                    type: source.type,
                    category: source.category,
                    page: i + 1
                }))
            );

            return pages.flatMap(page => page.results);
        }))
    ]);

    const sections: Section[] = [];
    const claimed = new Set<string>();

    const add = (section: Omit<Section, "items">, candidates: Media[]) => {
        const items: Media[] = [];

        for (const media of candidates) {
            if (claimed.has(mediaKey(media))) {
                continue;
            }

            claimed.add(mediaKey(media));
            items.push(media);

            if (items.length >= ROW_SIZE) {
                break;
            }
        }

        if (items.length > 0) {
            sections.push({ ...section, items });
        }
    };

    // the billboard title is claimed first, so it is not repeated in a row below
    const hero = catalog[0]?.find(media => media.backdrop_img && media.overview) || null;

    if (hero) {
        claimed.add(mediaKey(hero));
    }

    for (const row of PERSONAL) {
        const items = watchlist
            .filter(item => item.media && row.statuses.includes(item.status))
            .map(item => item.media as Media);

        add({ key: row.key, title: row.title, description: row.description, href: row.href }, items);
    }

    config.sources.forEach((source, index) => {
        add({
            key: source.key,
            title: source.title,
            description: source.description,
            href: source.href
        }, catalog[index] || []);
    });

    return { hero, sections };
};
