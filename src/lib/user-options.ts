import { useEffect, useMemo, useState } from "react";
import axios from "axios";

import { useSession } from "@/context/session";
import { TagOption } from "@/lib/options";
import { UserItem } from "@/types/user";

/**
 * Everybody with an account, for the two columns that say who wanted something — the
 * watchlist's owner and the library's requesters.
 *
 * **Empty for anybody who is not an administrator**, and that is the whole permission
 * model of both dropdowns on the client: `/api/users` refuses everybody else, so there
 * is no list to offer and the columns stay the plain text they have always been. The
 * server refuses the write as well, which is where it actually matters.
 *
 * The name and nothing else in the grey slot beside it: a row id means nothing to a
 * reader and an address does not fit in a table cell. The address is still a keyword,
 * so typing one finds its owner.
 */
export const useUserOptions = (): TagOption[] => {
    const { isAdmin } = useSession();
    const [ users, setUsers ] = useState<UserItem[]>([]);

    useEffect(() => {
        if (! isAdmin) {
            setUsers([]);

            return;
        }

        axios.get("/api/users")
            .then(res => setUsers(res.data.users || []))
            .catch(err => console.error(err));
    }, [ isAdmin ])

    return useMemo(() => users.map(user => ({
        value: String(user.id),
        label: user.name,
        hint: "",
        keywords: [ user.email ]
    })), [ users ]);
};

/** The name behind an id, for a toast that has to say who it just handed something to. */
export const userName = (options: TagOption[], id: number | string) => {
    return options.find(option => option.value === String(id))?.label || String(id);
};
