'use client';

import { WatchlistTable } from "@/components/watchlist-table";

export default function Page() {
    return (
        <WatchlistTable
            title="Downloaded"
            description="Already available on disk."
            onlyStatus="DOWNLOADED"
            emptyText="Nothing has been downloaded yet."
        />
    );
}
