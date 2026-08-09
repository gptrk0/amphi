'use client';

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, Loader2, MoreHorizontal, ShieldCheck, Trash2, UserPlus } from "lucide-react";
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
import { useSession } from "@/context/session";
import { UserItem, UserRoleName } from "@/types/user";

const ago = (value: string | null) => {
    if (! value) {
        return "never";
    }

    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);

    if (minutes < 1) {
        return "just now";
    }

    if (minutes < 60) {
        return `${ minutes }m ago`;
    }

    const hours = Math.round(minutes / 60);

    return hours < 48 ? `${ hours }h ago` : `${ Math.round(hours / 24) }d ago`;
};

/** How this account gets in, which is the thing that is easy to get wrong. */
const ways = (user: UserItem) => {
    const list = [ user.hasPassword ? "password" : "", user.linkedToProvider ? "single sign-on" : "" ].filter(Boolean);

    return list.length > 0 ? list.join(" + ") : "nothing yet";
};

const errorOf = (err: unknown, fallback: string) => {
    return (axios.isAxiosError(err) ? err.response?.data?.message : null) || fallback;
};

export default function Page() {
    const { state, isLoading: sessionLoading, isAdmin } = useSession();

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
            toast(`${ email } can sign in now.`);

        } catch(err) {
            toast(errorOf(err, "Could not create the account."));

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
            toast(errorOf(err, "Could not save that."));
        }
    };

    const setRole = (user: UserItem, role: UserRoleName) => {
        return patch(user, { role }, `${ user.email } is ${ role === "ADMIN" ? "an administrator" : "a user" } now.`);
    };

    const setDisabled = (user: UserItem, disabled: boolean) => {
        return patch(
            user,
            { disabled },
            disabled ? `${ user.email } is switched off and signed out.` : `${ user.email } can sign in again.`
        );
    };

    const savePassword = async () => {
        if (! passwordFor) {
            return;
        }

        setBusy(true);

        await patch(passwordFor, { password }, `A new password is set for ${ passwordFor.email }.`);

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
            toast(`${ removing.email } is gone.`);

        } catch(err) {
            toast(errorOf(err, "Could not delete the account."));

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
                <h2 className="text-2xl font-semibold tracking-tight">Users</h2>

                <p className="pt-2 text-sm text-muted-foreground">
                    This page is for administrators. Ask one of them if you need something changed.
                </p>
            </div>
        );
    }

    return (
        <div className="p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">Users</h2>

                    <p className="text-sm text-muted-foreground">
                        Everybody here shares one watchlist and one library. What the role decides is who may
                        change the settings, read the log, and delete downloads.
                    </p>
                </div>

                <Button className="shrink-0 cursor-pointer" onClick={() => setAdding(true)}>
                    <UserPlus />
                    Add user
                </Button>
            </div>

            <Separator className="my-5" />

            {! users && <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>}

            {users && <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Who</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Signs in with</TableHead>
                        <TableHead>Last seen</TableHead>
                        <TableHead className="text-right"></TableHead>
                    </TableRow>
                </TableHeader>

                <TableBody>
                    {users.map(user => (
                        <TableRow key={user.id} className={classNames({ "opacity-50": user.disabled })}>
                            <TableCell className="py-2">
                                <div className="font-medium">
                                    { user.name || user.email }
                                    {user.id === state?.user?.id && <span className="pl-2 text-xs text-muted-foreground">you</span>}
                                </div>

                                {user.name && <div className="text-xs text-muted-foreground">{ user.email }</div>}
                            </TableCell>

                            <TableCell className="py-2">
                                <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                                    { user.role === "ADMIN" ? "Admin" : "User" }
                                </Badge>

                                {user.disabled && <Badge variant="outline" className="ml-2">off</Badge>}
                            </TableCell>

                            <TableCell className="py-2 text-muted-foreground">{ ways(user) }</TableCell>
                            <TableCell className="py-2 text-muted-foreground">{ ago(user.lastLoginAt) }</TableCell>

                            <TableCell className="py-2 text-right">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="cursor-pointer">
                                            <MoreHorizontal />
                                        </Button>
                                    </DropdownMenuTrigger>

                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                            className="cursor-pointer"
                                            onClick={() => { setPasswordFor(user); setPassword(""); }}
                                        >
                                            <KeyRound />
                                            Set a password
                                        </DropdownMenuItem>

                                        {user.id !== state?.user?.id && <>
                                            <DropdownMenuItem
                                                className="cursor-pointer"
                                                onClick={() => setRole(user, user.role === "ADMIN" ? "USER" : "ADMIN")}
                                            >
                                                <ShieldCheck />
                                                { user.role === "ADMIN" ? "Make a plain user" : "Make an administrator" }
                                            </DropdownMenuItem>

                                            <DropdownMenuItem
                                                className="cursor-pointer"
                                                onClick={() => setDisabled(user, ! user.disabled)}
                                            >
                                                { user.disabled ? "Switch back on" : "Switch off" }
                                            </DropdownMenuItem>

                                            <DropdownMenuSeparator />

                                            <DropdownMenuItem
                                                variant="destructive"
                                                className="cursor-pointer"
                                                onClick={() => setRemoving(user)}
                                            >
                                                <Trash2 />
                                                Delete
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
                        <DialogTitle>Add a user</DialogTitle>

                        <DialogDescription>
                            The password is optional. Leave it empty for somebody who will arrive through single
                            sign-on — the first time they do, this account is what they land in.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <Input
                            type="email"
                            placeholder="them@example.com"
                            value={email}
                            onChange={event => setEmail(event.target.value)}
                        />

                        <Input
                            placeholder="Name (optional)"
                            value={name}
                            onChange={event => setName(event.target.value)}
                        />

                        <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder="Password (optional)"
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                        />

                        <div className="flex items-center justify-between rounded-md border p-3">
                            <div>
                                <div className="text-sm font-medium">Administrator</div>

                                <div className="text-xs text-muted-foreground">
                                    Settings, the log, and deleting downloads.
                                </div>
                            </div>

                            <Switch checked={admin} onCheckedChange={setAdmin} className="cursor-pointer" />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setAdding(false)}>Cancel</Button>

                        <Button className="cursor-pointer" onClick={create} disabled={isBusy || ! email}>
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                            Add
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!! passwordFor} onOpenChange={next => { if (! next) { setPasswordFor(null); setPassword(""); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>A new password for { passwordFor?.email }</DialogTitle>

                        <DialogDescription>
                            Every browser signed in as them is signed out by this.
                            {passwordFor?.linkedToProvider && " Leave it empty to take the password away and leave only single sign-on."}
                        </DialogDescription>
                    </DialogHeader>

                    <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                    />

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setPasswordFor(null)}>Cancel</Button>

                        <Button className="cursor-pointer" onClick={savePassword} disabled={isBusy}>
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!! removing} onOpenChange={next => { if (! next) { setRemoving(null); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete { removing?.email }?</DialogTitle>

                        <DialogDescription>
                            Their sessions go with them. Nothing on the watchlist or in the library is touched —
                            those belong to the install, not to a person.
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button variant="outline" className="cursor-pointer" onClick={() => setRemoving(null)}>Cancel</Button>

                        <Button variant="destructive" className="cursor-pointer" onClick={remove} disabled={isBusy}>
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isBusy })} />
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
