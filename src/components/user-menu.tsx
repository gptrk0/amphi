'use client';

import { useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, Loader2, LogOut, UserCog } from "lucide-react";
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
import { useLocale } from "@/context/locale";
import { useSession } from "@/context/session";

// two letters off whatever there is to work with, which beats a stock avatar nobody
// recognises
const initials = (name: string) => {
    const source = name.trim();
    const parts = source.split(/[\s._-]+/).filter(Boolean);

    return (parts.length > 1 ? `${ parts[0][0] }${ parts[1][0] }` : source.slice(0, 2)).toUpperCase();
};

export function UserMenu() {
    const { state, isLoading, signOut, refresh } = useSession();
    const { t } = useLocale();

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

            toast(t("userMenu.password.done"));
            setOpen(false);
            setCurrent("");
            setNext("");

            await refresh();

        } catch(err) {
            toast((axios.isAxiosError(err) ? err.response?.data?.message : null) || t("userMenu.password.failed"));

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
                            { initials(user.name) }
                        </span>

                        <span className="hidden sm:inline">{ user.name }</span>
                    </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                        <div className="font-medium">{ user.name }</div>

                        <div className="text-xs font-normal text-muted-foreground">
                            { user.email } · { user.isAdmin ? t("userMenu.administrator") : t("userMenu.user") }
                        </div>
                    </DropdownMenuLabel>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem asChild className="cursor-pointer">
                        <Link href="/account">
                            <UserCog />
                            { t("userMenu.account") }
                        </Link>
                    </DropdownMenuItem>

                    {user.hasPassword && (
                        <DropdownMenuItem className="cursor-pointer" onClick={() => setOpen(true)}>
                            <KeyRound />
                            { t("userMenu.changePassword") }
                        </DropdownMenuItem>
                    )}

                    <DropdownMenuItem className="cursor-pointer" onClick={signOut}>
                        <LogOut />
                        { t("userMenu.signOut") }
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{ t("userMenu.password.title") }</DialogTitle>

                        <DialogDescription>{ t("userMenu.password.description") }</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <Input
                            type="password"
                            autoComplete="current-password"
                            placeholder={t("userMenu.password.current")}
                            value={current}
                            onChange={event => setCurrent(event.target.value)}
                        />

                        <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder={t("userMenu.password.next")}
                            value={next}
                            onChange={event => setNext(event.target.value)}
                        />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setOpen(false)}>
                            { t("common.cancel") }
                        </Button>

                        <Button className="cursor-pointer" onClick={change} disabled={isBusy || ! current || ! next}>
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                            { t("userMenu.password.submit") }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
