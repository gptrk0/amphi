'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Teko } from "next/font/google";
import { Loader2, ShieldCheck } from "lucide-react";
import classNames from "classnames";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthState } from "@/types/user";

const teko = Teko({ subsets: [ 'latin' ] });

/**
 * The first run. Whoever opens a fresh install first becomes its administrator — the
 * bargain every self hosted thing makes, and the window closes the moment one account
 * exists. Everything else in the app is behind a login from here on.
 */
export default function Page() {
    const router = useRouter();

    const [ ready, setReady ] = useState(false);
    const [ email, setEmail ] = useState("");
    const [ name, setName ] = useState("");
    const [ password, setPassword ] = useState("");
    const [ again, setAgain ] = useState("");
    const [ error, setError ] = useState("");
    const [ isBusy, setBusy ] = useState(false);

    useEffect(() => {
        axios.get("/api/auth/state")
            .then(res => {
                const state = res.data as AuthState;

                if (! state.needsSetup) {
                    router.replace("/login");

                    return;
                }

                setReady(true);
            })
            .catch(err => console.error(err));
    }, [ router ])

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (password !== again) {
            setError("The two passwords are not the same.");

            return;
        }

        setBusy(true);
        setError("");

        try {
            await axios.post("/api/auth/setup", { email, name, password });

            window.location.href = "/";

        } catch(err) {
            const message = axios.isAxiosError(err) ? err.response?.data?.message : null;

            setError(message || "Could not create the account.");
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <div className="w-full max-w-sm space-y-6">
                <div className="space-y-2 text-center">
                    <span className={classNames(teko.className, "text-6xl")}>aioseerr</span>

                    <p className="text-sm text-muted-foreground">
                        Nobody has an account here yet. The first one is the administrator.
                    </p>
                </div>

                {! ready && <Skeleton className="h-64 w-full" />}

                {ready && <form className="space-y-3" onSubmit={submit}>
                    <Input
                        type="email"
                        autoComplete="username"
                        placeholder="you@example.com"
                        value={email}
                        onChange={event => setEmail(event.target.value)}
                        autoFocus
                    />

                    <Input
                        placeholder="Your name (optional)"
                        value={name}
                        onChange={event => setName(event.target.value)}
                    />

                    <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="Password, at least 8 characters"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                    />

                    <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="The same again"
                        value={again}
                        onChange={event => setAgain(event.target.value)}
                    />

                    <Button type="submit" className="w-full cursor-pointer" disabled={isBusy}>
                        <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                        <ShieldCheck className={classNames({ "hidden": isBusy })} />
                        Create the administrator
                    </Button>

                    {error && <p className="text-sm text-destructive">{ error }</p>}
                </form>}
            </div>
        </div>
    );
}
