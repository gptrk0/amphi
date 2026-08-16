'use client';

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, Loader2, MoreHorizontal, ShieldCheck, Trash2, UserCog, UserPlus } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
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
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocale } from "@/context/locale";
import { useSession } from "@/context/session";
import { Translate } from "@/i18n";
import { UserItem, UserRoleName } from "@/types/user";

const ago = (value: string | null, t: Translate) => {
    if (! value) {
        return t("common.never");
    }

    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);

    if (minutes < 1) {
        return t("common.justNow");
    }

    if (minutes < 60) {
        return t("common.minutesAgo", { n: minutes });
    }

    const hours = Math.round(minutes / 60);

    return hours < 48 ? t("common.hoursAgo", { n: hours }) : t("common.daysAgo", { n: Math.round(hours / 24) });
};

/** How this account gets in, which is the thing that is easy to get wrong. */
const ways = (user: UserItem, t: Translate) => {
    const list = [ user.hasPassword ? t("users.withPassword") : "", user.linkedToProvider ? t("users.withSso") : "" ].filter(Boolean);

    return list.length > 0 ? list.join(" + ") : t("users.withNothing");
};

const errorOf = (err: unknown, fallback: string) => {
    return (axios.isAxiosError(err) ? err.response?.data?.message : null) || fallback;
};

export default function Page() {
    const { state, isLoading: sessionLoading, isAdmin } = useSession();
    const { t } = useLocale();

    const [ users, setUsers ] = useState<UserItem[]>();
    const [ adding, setAdding ] = useState(false);
    const [ isBusy, setBusy ] = useState(false);
    const [ passwordFor, setPasswordFor ] = useState<UserItem | null>(null);
    const [ removing, setRemoving ] = useState<UserItem | null>(null);

    const [ email, setEmail ] = useState("");
    const [ name, setName ] = useState("");
    const [ password, setPassword ] = useState("");
    const [ admin, setAdmin ] = useState(false);

    const load = () => {
        return axios.get("/api/users")
            .then(res => setUsers(res.data.users || []))
            .catch(err => console.error(err));
    };

    useEffect(() => {
        if (isAdmin) {
            load();
        }
    }, [ isAdmin ])

    const resetForm = () => {
        setEmail("");
        setName("");
        setPassword("");
        setAdmin(false);
    };

    const create = async () => {
        setBusy(true);

        try {
            const res = await axios.post("/api/users", { email, name, password, role: admin ? "ADMIN" : "USER" });

            setUsers(res.data.users);
            setAdding(false);
            resetForm();
            toast(t("users.created", { email }));

        } catch(err) {
            toast(errorOf(err, t("users.createFailed")));

        } finally {
            setBusy(false);
        }
    };

    const patch = async (user: UserItem, changes: Record<string, unknown>, said: string) => {
        try {
            const res = await axios.patch(`/api/users/${ user.id }`, changes);

            setUsers(res.data.users);
            toast(said);

        } catch(err) {
            toast(errorOf(err, t("users.saveFailed")));
        }
    };

    const setRole = (user: UserItem, role: UserRoleName) => {
        return patch(user, { role }, t("users.roleChanged", { email: user.email, role: role === "ADMIN" ? t("users.roleAdmin") : t("users.roleUser") }));
    };

    const setDisabled = (user: UserItem, disabled: boolean) => {
        return patch(
            user,
            { disabled },
            disabled ? t("users.switchedOff", { email: user.email }) : t("users.switchedOn", { email: user.email })
        );
    };

    const savePassword = async () => {
        if (! passwordFor) {
            return;
        }

        setBusy(true);

        await patch(passwordFor, { password }, t("users.passwordSet", { email: passwordFor.email }));

        setBusy(false);
        setPasswordFor(null);
        setPassword("");
    };

    const remove = async () => {
        if (! removing) {
            return;
        }

        setBusy(true);

        try {
            const res = await axios.delete(`/api/users/${ removing.id }`);

            setUsers(res.data.users);
            toast(t("users.deleted", { email: removing.email }));

        } catch(err) {
            toast(errorOf(err, t("users.deleteFailed")));

        } finally {
            setBusy(false);
            setRemoving(null);
        }
    };

    if (sessionLoading) {
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

    return (
        <div className="p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">{ t("users.title") }</h2>

                    <p className="text-sm text-muted-foreground">
                        { t("users.intro") }
                    </p>
                </div>

                <Button className="shrink-0 cursor-pointer" onClick={() => setAdding(true)}>
                    <UserPlus />
                    { t("users.add") }
                </Button>
            </div>

            <Separator className="my-5" />

            {! users && <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>}

            {users && <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{ t("users.columns.who") }</TableHead>
                        <TableHead>{ t("users.columns.role") }</TableHead>
                        <TableHead>{ t("users.columns.signsIn") }</TableHead>
                        <TableHead>{ t("users.columns.lastSeen") }</TableHead>
                        <TableHead className="text-right"></TableHead>
                    </TableRow>
                </TableHeader>

                <TableBody>
                    {users.map(user => (
                        <TableRow key={user.id} className={classNames({ "opacity-50": user.disabled })}>
                            <TableCell className="py-2">
                                <div className="font-medium">
                                    { user.name }
                                    {user.id === state?.user?.id && <span className="pl-2 text-xs text-muted-foreground">{ t("users.you") }</span>}
                                </div>

                                <div className="text-xs text-muted-foreground">{ user.email }</div>
                            </TableCell>

                            <TableCell className="py-2">
                                <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                                    { user.role === "ADMIN" ? t("users.admin") : t("users.user") }
                                </Badge>

                                {user.disabled && <Badge variant="outline" className="ml-2">{ t("users.off") }</Badge>}
                            </TableCell>

                            <TableCell className="py-2 text-muted-foreground">{ ways(user, t) }</TableCell>
                            <TableCell className="py-2 text-muted-foreground">{ ago(user.lastLoginAt, t) }</TableCell>

                            <TableCell className="py-2 text-right">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="cursor-pointer">
                                            <MoreHorizontal />
                                        </Button>
                                    </DropdownMenuTrigger>

                                    <DropdownMenuContent align="end">
                                        {/* their own settings page, opened by somebody
                                            else — the languages they want and where their
                                            notifications go, which is the part of setting
                                            an account up that nobody wants to explain over
                                            the phone */}
                                        <DropdownMenuItem asChild className="cursor-pointer">
                                            <Link href={`/users/${ user.id }`}>
                                                <UserCog />
                                                { t("users.accountSettings") }
                                            </Link>
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                            className="cursor-pointer"
                                            onClick={() => { setPasswordFor(user); setPassword(""); }}
                                        >
                                            <KeyRound />
                                            { t("users.setPassword") }
                                        </DropdownMenuItem>

                                        {user.id !== state?.user?.id && <>
                                            <DropdownMenuItem
                                                className="cursor-pointer"
                                                onClick={() => setRole(user, user.role === "ADMIN" ? "USER" : "ADMIN")}
                                            >
                                                <ShieldCheck />
                                                { user.role === "ADMIN" ? t("users.makeUser") : t("users.makeAdmin") }
                                            </DropdownMenuItem>

                                            <DropdownMenuItem
                                                className="cursor-pointer"
                                                onClick={() => setDisabled(user, ! user.disabled)}
                                            >
                                                { user.disabled ? t("users.switchOn") : t("users.switchOff") }
                                            </DropdownMenuItem>

                                            <DropdownMenuSeparator />

                                            <DropdownMenuItem
                                                variant="destructive"
                                                className="cursor-pointer"
                                                onClick={() => setRemoving(user)}
                                            >
                                                <Trash2 />
                                                { t("users.delete") }
                                            </DropdownMenuItem>
                                        </>}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>}

            <Dialog open={adding} onOpenChange={next => { setAdding(next); if (! next) { resetForm(); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{ t("users.addTitle") }</DialogTitle>

                        <DialogDescription>
                            { t("users.addNote") }
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <Input
                            type="email"
                            placeholder={t("users.emailPlaceholder")}
                            value={email}
                            onChange={event => setEmail(event.target.value)}
                        />

                        <Input
                            placeholder={t("users.namePlaceholder")}
                            value={name}
                            onChange={event => setName(event.target.value)}
                        />

                        <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder={t("users.passwordPlaceholder")}
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                        />

                        <div className="flex items-center justify-between rounded-md border p-3">
                            <div>
                                <div className="text-sm font-medium">{ t("users.administrator") }</div>

                                <div className="text-xs text-muted-foreground">
                                    { t("users.administratorNote") }
                                </div>
                            </div>

                            <Switch checked={admin} onCheckedChange={setAdmin} className="cursor-pointer" />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setAdding(false)}>{ t("common.cancel") }</Button>

                        <Button className="cursor-pointer" onClick={create} disabled={isBusy || ! email || ! name.trim()}>
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                            { t("users.addButton") }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!! passwordFor} onOpenChange={next => { if (! next) { setPasswordFor(null); setPassword(""); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{ t("users.passwordTitle", { email: passwordFor?.email || "" }) }</DialogTitle>

                        <DialogDescription>
                            { t("users.passwordNote") }
                            {passwordFor?.linkedToProvider && t("users.passwordNoteProvider")}
                        </DialogDescription>
                    </DialogHeader>

                    <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder={t("users.passwordPlaceholderNew")}
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                    />

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setPasswordFor(null)}>{ t("common.cancel") }</Button>

                        <Button className="cursor-pointer" onClick={savePassword} disabled={isBusy}>
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                            { t("common.save") }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!! removing} onOpenChange={next => { if (! next) { setRemoving(null); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{ t("users.deleteTitle", { email: removing?.email || "" }) }</DialogTitle>

                        <DialogDescription>
                            { t("users.deleteNote") }
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setRemoving(null)}>{ t("common.cancel") }</Button>

                        <Button variant="destructive" className="cursor-pointer" onClick={remove} disabled={isBusy}>
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                            { t("users.delete") }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
