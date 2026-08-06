'use client';

import { WatchlistGrid } from "@/components/watchlist-grid";

export default function Page() {
    return (
        <WatchlistGrid
            title="Downloaded"
            description="Already available on disk."
            onlyStatus="DOWNLOADED"
            emptyText="Nothing has been downloaded yet."
        />
    );
}
