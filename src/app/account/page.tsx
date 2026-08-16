import { AccountSettings } from "@/components/account-settings";

/**
 * Your own account settings. Somebody else's is `/users/[id]`, which is this same form
 * with an id — see `AccountSettings` for why there is only one of it.
 */
export default function Page() {
    return <AccountSettings />;
}
