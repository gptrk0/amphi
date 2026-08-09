'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/context/session";

/**
 * An admin page, for somebody who is not one. The check that counts is the one on the
 * api — this is here so the page says so in a sentence instead of loading forever
 * behind a wall of failed requests. Children are not rendered at all, so nothing they
 * would have asked for is ever asked for.
 */
export function AdminOnly({ title, children }: { title: string, children: React.ReactNode }) {
    const { isAdmin, isLoading } = useSession();

    if (isLoading) {
        return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
    }

    if (! isAdmin) {
        return (
            <div className="p-4">
                <h2 className="text-2xl font-semibold tracking-tight">{ title }</h2>

                <p className="pt-2 text-sm text-muted-foreground">
                    This page is for administrators. Ask one of them if you need something changed.
                </p>
            </div>
        );
    }

    return <>{ children }</>;
}
