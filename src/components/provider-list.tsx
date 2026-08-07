'use client';

import Image from "next/image";
import { ExternalLink } from "lucide-react";

import { MediaCompany, MediaProviders } from "@/types/media";

type Props = {
    providers: MediaProviders;
    region: string;
};

const GROUPS: { key: keyof Omit<MediaProviders, "link">, label: string }[] = [
    { key: "flatrate", label: "Stream" },
    { key: "rent", label: "Rent" },
    { key: "buy", label: "Buy" }
];

function Logos({ items }: { items: MediaCompany[] }) {
    return (
        <div className="flex flex-wrap gap-2">
            {items.map(provider => (
                <Image
                    key={provider.id}
                    src={provider.logo_img}
                    alt={provider.name}
                    title={provider.name}
                    width={40}
                    height={40}
                    className="size-10 rounded-md"
                />
            ))}
        </div>
    );
}

/**
 * Where it can be watched legally, as TMDB gets it from JustWatch. Region bound —
 * what shows here is what is offered in TMDB_REGION.
 */
export function ProviderList({ providers, region }: Props) {
    const groups = GROUPS.filter(group => providers[group.key].length > 0);

    if (groups.length === 0) {
        return null;
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight">Where to watch</h3>
                <span className="text-xs text-muted-foreground">{ region }</span>

                {providers.link && <a
                    href={providers.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    title="Open on JustWatch"
                >
                    <ExternalLink className="size-4" />
                </a>}
            </div>

            <div className="flex flex-wrap gap-6">
                {groups.map(group => (
                    <div key={group.key} className="space-y-1.5">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{ group.label }</div>
                        <Logos items={providers[group.key]} />
                    </div>
                ))}
            </div>
        </div>
    );
}
