'use client';

import { ReactNode } from "react";

export type Fact = {
    label: string;
    value: ReactNode;
};

/**
 * The dry facts nobody scrolls for but everybody looks up eventually. Anything
 * TMDB does not know is left out instead of shown as an empty line.
 */
export function FactGrid({ title, facts }: { title: string, facts: Fact[] }) {
    const known = facts.filter(fact => fact.value !== null && fact.value !== undefined && fact.value !== "");

    if (known.length === 0) {
        return null;
    }

    return (
        <div className="space-y-3">
            <h3 className="text-lg font-semibold tracking-tight">{ title }</h3>

            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {known.map(fact => (
                    <div key={fact.label} className="border-t pt-2">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{ fact.label }</dt>
                        <dd className="text-sm">{ fact.value }</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
