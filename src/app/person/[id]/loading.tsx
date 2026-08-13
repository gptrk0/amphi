import { Skeleton } from "@/components/ui/skeleton";

/** Same reason as the title page: a click has to look like it did something. */
export default function Loading() {
    return (
        <div className="space-y-10 p-4 pb-12 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:gap-8">
                <Skeleton className="aspect-[2/3] w-[160px] shrink-0 rounded-lg md:w-[220px]" />

                <div className="min-w-0 flex-1 space-y-4">
                    <div className="space-y-2">
                        <Skeleton className="h-9 w-1/2" />
                        <Skeleton className="h-5 w-20" />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                    </div>

                    <div className="space-y-2">
                        <Skeleton className="h-4 w-full max-w-3xl" />
                        <Skeleton className="h-4 w-full max-w-3xl" />
                        <Skeleton className="h-4 w-2/3 max-w-3xl" />
                    </div>
                </div>
            </div>
        </div>
    );
}
