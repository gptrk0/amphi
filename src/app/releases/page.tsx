'use client';

import { Suspense } from "react";

import { ReleaseSearchPage } from "@/components/release-search";

export default function Page() {
    return (
        <Suspense>
            <ReleaseSearchPage />
        </Suspense>
    );
}
