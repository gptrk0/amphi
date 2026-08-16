'use client';

import { useParams } from "next/navigation";

import { AccountSettings } from "@/components/account-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/context/locale";
import { useSession } from "@/context/session";

/**
 * Somebody else's account settings, reached from the users list. The same form as
 * `/account`, and the same refusal as the list itself for anybody who is not an
 * administrator — the api says no on its own, this is only so the page says why.
 */
export default function Page() {
    const params = useParams<{ id: string }>();
    const { isLoading, isAdmin } = useSession();
    const { t } = useLocale();

    const userId = Number(params?.id);

    if (isLoading) {
        return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
    }

    if (! isAdmin) {
        return (
            <div className="p-4">
                <h2 className="text-2xl font-semibold tracking-tight">{ t("users.title") }</h2>

                <p className="pt-2 text-sm text-muted-foreground">
                    { t("adminOnly.note") }
                </p>
            </div>
        );
    }

    if (! userId) {
        return <div className="p-4"><p className="text-sm text-muted-foreground">{ t("account.missing") }</p></div>;
    }

    return <AccountSettings userId={userId} />;
}
