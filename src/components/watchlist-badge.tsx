import { Badge } from "@/components/ui/badge";
import { WatchlistEntry } from "@/types/watchlist";

type Props = {
    entry?: WatchlistEntry;
    className?: string;
};

// SEARCHING means the search already ran and came back empty, which is the normal
// state of anything that is not out in a usable quality yet — "Searching..." read
// like something was in progress right now
const labels: Record<string, { text: string, variant: "default" | "secondary" | "destructive" | "outline" }> = {
    PENDING:     { text: "Watchlisted",         variant: "secondary" },
    SEARCHING:   { text: "Waiting for release", variant: "secondary" },
    DOWNLOADING: { text: "Downloading",         variant: "default" },
    DOWNLOADED:  { text: "Available",           variant: "default" },
    FAILED:      { text: "Not found",           variant: "destructive" }
};

export function WatchlistBadge({ entry, className }: Props) {
    if (! entry) {
        return null;
    }

    const label = labels[entry.status] || labels.PENDING;

    const text = entry.type === "tv" && entry.episodeCount > 0 && entry.downloadedCount > 0
        ? `${ label.text } ${ entry.downloadedCount }/${ entry.episodeCount }`
        : label.text;

    return <Badge variant={ label.variant } className={ className }>{ text }</Badge>;
}
