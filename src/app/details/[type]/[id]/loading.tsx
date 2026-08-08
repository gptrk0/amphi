import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without a loading boundary the router paints nothing until the page is rendered,
 * so a click looks like it did nothing at all. This is also what makes the card
 * links prefetchable: a Link only warms the route up to its nearest boundary.
 */
export default function Loading() {
    return (
        <div className="space-y-10 p-4 pb-12 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:gap-8">
                <Skeleton className="h-[240px] w-[160px] shrink-0 rounded-lg md:h-[330px] md:w-[220px]" />

                <div className="min-w-0 flex-1 space-y-4 md:pt-6">
                    <Skeleton className="h-5 w-24" />

                    <div className="space-y-2">
                        <Skeleton className="h-9 w-2/3" />
                        <Skeleton className="h-4 w-1/3" />
                    </div>

                    <Skeleton className="h-4 w-1/2" />

                    <div className="space-y-2">
                        <Skeleton className="h-4 w-full max-w-3xl" />
                        <Skeleton className="h-4 w-full max-w-3xl" />
                        <Skeleton className="h-4 w-2/3 max-w-3xl" />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Skeleton className="h-9 w-32" />
                        <Skeleton className="h-9 w-28" />
                    </div>
                </div>
            </div>
        </div>
    );
}
