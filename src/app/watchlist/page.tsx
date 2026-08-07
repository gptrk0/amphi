'use client';

import { WatchlistTable } from "@/components/watchlist-table";

export default function Page() {
    return (
        <WatchlistTable
            title="Watchlist"
            description="Everything the app watches and downloads as soon as it shows up."
            emptyText="Your watchlist is empty — add something from a details page or by right clicking a poster."
        />
    );
}
