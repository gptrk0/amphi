'use client';

import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/context/locale";
import { MessageKey } from "@/i18n";
import { WatchlistEntry } from "@/types/watchlist";

type Props = {
    entry?: WatchlistEntry;
    className?: string;
};

/**
 * The wording of each state is in the dictionary (`status.*`), the *look* of it is here.
 *
 * SEARCHING means the search already ran and came back empty, which is the normal state of
 * anything that is not out in a usable quality yet — "Searching..." read like something was
 * in progress right now. UPCOMING is not the same: that one has not been looked for at all,
 * because it does not exist yet.
 */
const VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    PENDING: "secondary",
    UPCOMING: "outline",
    SEARCHING: "secondary",
    DOWNLOADING: "default",
    DOWNLOADED: "default",
    FAILED: "destructive"
};

export function WatchlistBadge({ entry, className }: Props) {
    const { t } = useLocale();

    if (! entry) {
        return null;
    }

    const status = VARIANTS[entry.status] ? entry.status : "PENDING";
    const label = t(`status.${ status }` as MessageKey);

    const text = entry.type === "tv" && entry.episodeCount > 0 && entry.downloadedCount > 0
        ? `${ label } ${ entry.downloadedCount }/${ entry.episodeCount }`
        : label;

    return <Badge variant={ VARIANTS[status] } className={ className }>{ text }</Badge>;
}
