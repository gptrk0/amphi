'use client';

import { WatchlistTable } from "@/components/watchlist-table";

export default function Page() {
    return (
        <WatchlistTable
            title="Library"
            description="Everything you have on disk."
            onlyStatus="DOWNLOADED"
            emptyText="Nothing has been downloaded yet."
        />
    );
}
