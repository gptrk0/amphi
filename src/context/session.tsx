'use client';

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

import { AuthState } from "@/types/user";

type SessionContextValue = {
    state: AuthState | null;
    isLoading: boolean;
    isAdmin: boolean;
    refresh: () => Promise<void>;
    signOut: () => Promise<void>;
};

const EMPTY: SessionContextValue = {
    state: null,
    isLoading: true,
    isAdmin: false,
    refresh: async () => {},
    signOut: async () => {}
};

const SessionContext = createContext<SessionContextValue>(EMPTY);

export const useSession = () => useContext(SessionContext);

/**
 * Who is signed in, for everything that has to be drawn differently. The server is
 * the one that decides — this is what the sidebar and the buttons read so a user is
 * not offered an admin page that would only answer with a 403.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
    const [ state, setState ] = useState<AuthState | null>(null);
    const [ isLoading, setLoading ] = useState(true);
    const router = useRouter();

    const refresh = useCallback(async () => {
        try {
            const res = await axios.get("/api/auth/state");

            setState(res.data);

        } catch(err) {
            console.error(err);

        } finally {
            setLoading(false);
        }
    }, []);

    const signOut = useCallback(async () => {
        await axios.post("/api/auth/logout").catch(err => console.error(err));

        // a full navigation and not a router push: everything in memory belongs to the
        // person who just left
        window.location.href = "/login";
    }, []);

    useEffect(() => {
        refresh();
    }, [ refresh ])

    /**
     * A session that ended while the tab was open — expired, switched off, signed out
     * in another window. Without this the page just quietly stops loading anything.
     */
    useEffect(() => {
        const id = axios.interceptors.response.use(
            response => response,
            error => {
                if (error?.response?.status === 401) {
                    router.replace(`/login?next=${ encodeURIComponent(window.location.pathname) }`);
                }

                return Promise.reject(error);
            }
        );

        return () => axios.interceptors.response.eject(id);
    }, [ router ])

    return (
        <SessionContext.Provider value={{ state, isLoading, isAdmin: !! state?.user?.isAdmin, refresh, signOut }}>
            { children }
        </SessionContext.Provider>
    );
}
