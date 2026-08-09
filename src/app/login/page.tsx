'use client';

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { Teko } from "next/font/google";
import { KeyRound, Loader2, LogIn } from "lucide-react";
import classNames from "classnames";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthState } from "@/types/user";

const teko = Teko({ subsets: [ 'latin' ] });

// only inside this app, or the address bar becomes somebody else's redirect
const safeNext = (value: string | null) => {
    return value && value.startsWith("/") && ! value.startsWith("//") ? value : "/";
};

function LoginForm() {
    const router = useRouter();
    const params = useSearchParams();
    const next = safeNext(params.get("next"));

    const [ state, setState ] = useState<AuthState>();
    const [ email, setEmail ] = useState("");
    const [ password, setPassword ] = useState("");
    const [ error, setError ] = useState(params.get("message") || "");
    const [ isBusy, setBusy ] = useState(false);

    useEffect(() => {
        axios.get("/api/auth/state")
            .then(res => {
                const answer = res.data as AuthState;

                // nobody has claimed this install yet, and the first thing it can be
                // asked for is not a password but an administrator
                if (answer.needsSetup) {
                    router.replace("/setup");

                    return;
                }

                if (answer.user) {
                    router.replace(next);

                    return;
                }

                setState(answer);
            })
            .catch(err => {
                console.error(err);
                setError("The server did not answer.");
            });
    }, [ router, next ])

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();

        setBusy(true);
        setError("");

        try {
            await axios.post("/api/auth/login", { email, password });

            // a full load: the providers above this page all read the session once
            window.location.href = next;

        } catch(err) {
            const message = axios.isAxiosError(err) ? err.response?.data?.message : null;

            setError(message || "Signing in failed.");
            setBusy(false);
        }
    };

    if (! state) {
        return <Skeleton className="h-56 w-full" />;
    }

    return (
        <div className="space-y-5">
            {state.oidc.enabled && (
                <Button
                    className="w-full cursor-pointer"
                    variant={state.passwordLogin ? "outline" : "default"}
                    onClick={() => { window.location.href = `/api/auth/oidc/start?next=${ encodeURIComponent(next) }`; }}
                >
                    <KeyRound />
                    Continue with { state.oidc.name }
                </Button>
            )}

            {state.oidc.enabled && state.passwordLogin && (
                <div className="flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <Separator className="flex-1" />
                </div>
            )}

            {state.passwordLogin && (
                <form className="space-y-3" onSubmit={submit}>
                    <Input
                        type="email"
                        autoComplete="username"
                        placeholder="you@example.com"
                        value={email}
                        onChange={event => setEmail(event.target.value)}
                        autoFocus
                    />

                    <Input
                        type="password"
                        autoComplete="current-password"
                        placeholder="Password"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                    />

                    <Button type="submit" className="w-full cursor-pointer" disabled={isBusy}>
                        <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                        <LogIn className={classNames({ "hidden": isBusy })} />
                        Sign in
                    </Button>
                </form>
            )}

            {! state.passwordLogin && ! state.oidc.enabled && (
                <p className="text-sm text-muted-foreground">
                    There is no way to sign in configured. Somebody with access to the database has to fix that.
                </p>
            )}

            {error && <p className="text-sm text-destructive">{ error }</p>}
        </div>
    );
}

export default function Page() {
    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <div className="w-full max-w-sm space-y-6">
                <div className="text-center">
                    <span className={classNames(teko.className, "text-6xl")}>aioseerr</span>
                </div>

                <Suspense fallback={<Skeleton className="h-56 w-full" />}>
                    <LoginForm />
                </Suspense>
            </div>
        </div>
    );
}
