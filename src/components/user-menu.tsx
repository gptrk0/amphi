'use client';

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import classNames from "classnames";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useSession } from "@/context/session";

// two letters off whatever there is to work with, which beats a stock avatar nobody
// recognises
const initials = (name: string, email: string) => {
    const source = (name || email).trim();
    const parts = source.split(/[\s._-]+/).filter(Boolean);

    return (parts.length > 1 ? `${ parts[0][0] }${ parts[1][0] }` : source.slice(0, 2)).toUpperCase();
};

export function UserMenu() {
    const { state, isLoading, signOut, refresh } = useSession();

    const [ open, setOpen ] = useState(false);
    const [ current, setCurrent ] = useState("");
    const [ next, setNext ] = useState("");
    const [ isBusy, setBusy ] = useState(false);

    const user = state?.user;

    if (isLoading || ! user) {
        return null;
    }

    const change = async () => {
        setBusy(true);

        try {
            await axios.patch("/api/auth/me", { currentPassword: current, password: next });

            toast("Your password is changed — every other browser was signed out.");
            setOpen(false);
            setCurrent("");
            setNext("");

            await refresh();

        } catch(err) {
            toast((axios.isAxiosError(err) ? err.response?.data?.message : null) || "Could not change it.");

        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="cursor-pointer gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                            { initials(user.name, user.email) }
                        </span>

                        <span className="hidden sm:inline">{ user.name || user.email }</span>
                    </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                        <div className="font-medium">{ user.name || user.email }</div>

                        <div className="text-xs font-normal text-muted-foreground">
                            { user.email } · { user.isAdmin ? "administrator" : "user" }
                        </div>
                    </DropdownMenuLabel>

                    <DropdownMenuSeparator />

                    {user.hasPassword && (
                        <DropdownMenuItem className="cursor-pointer" onClick={() => setOpen(true)}>
                            <KeyRound />
                            Change password
                        </DropdownMenuItem>
                    )}

                    <DropdownMenuItem className="cursor-pointer" onClick={signOut}>
                        <LogOut />
                        Sign out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Change your password</DialogTitle>

                        <DialogDescription>
                            The old one is asked for even though you are signed in — an unattended browser should
                            not be enough to take an account over. Every other browser is signed out.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <Input
                            type="password"
                            autoComplete="current-password"
                            placeholder="Your current password"
                            value={current}
                            onChange={event => setCurrent(event.target.value)}
                        />

                        <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder="The new one, at least 8 characters"
                            value={next}
                            onChange={event => setNext(event.target.value)}
                        />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setOpen(false)}>Cancel</Button>

                        <Button className="cursor-pointer" onClick={change} disabled={isBusy || ! current || ! next}>
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                            Change it
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
