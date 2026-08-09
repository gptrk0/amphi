'use client';

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { TagInput } from "@/components/tag-input";
import { useSession } from "@/context/session";

type Account = {
    id: number;
    email: string;
    name: string;
    role: "ADMIN" | "USER";
    hasPassword: boolean;
    linkedToProvider: boolean;
    telegramChatId: string;
    telegramEvents: string;
};

const EVENTS = "ready, started, dropped";

/**
 * The settings that are yours rather than the install's. The admin page decides how
 * the app behaves; this decides how it behaves towards you — what you are called and
 * where you hear about your own downloads.
 */
export default function Page() {
    const { refresh } = useSession();

    const [ account, setAccount ] = useState<Account>();
    const [ name, setName ] = useState("");
    const [ chatId, setChatId ] = useState("");
    const [ events, setEvents ] = useState("");
    const [ current, setCurrent ] = useState("");
    const [ next, setNext ] = useState("");
    const [ isSaving, setSaving ] = useState(false);
    const [ isChanging, setChanging ] = useState(false);

    const load = (data: Account) => {
        setAccount(data);
        setName(data.name);
        setChatId(data.telegramChatId);
        setEvents(data.telegramEvents);
    };

    useEffect(() => {
        axios.get("/api/auth/me")
            .then(res => load(res.data.account))
            .catch(err => console.error(err));
    }, [])

    const save = async () => {
        setSaving(true);

        try {
            await axios.patch("/api/auth/me", { name, telegramChatId: chatId, telegramEvents: events });

            const res = await axios.get("/api/auth/me");

            load(res.data.account);
            await refresh();

            toast("Saved.");

        } catch(err) {
            toast((axios.isAxiosError(err) ? err.response?.data?.message : null) || "Could not save that.");

        } finally {
            setSaving(false);
        }
    };

    const changePassword = async () => {
        setChanging(true);

        try {
            await axios.patch("/api/auth/me", { currentPassword: current, password: next });

            setCurrent("");
            setNext("");

            toast("Your password is changed — every other browser was signed out.");

        } catch(err) {
            toast((axios.isAxiosError(err) ? err.response?.data?.message : null) || "Could not change it.");

        } finally {
            setChanging(false);
        }
    };

    if (! account) {
        return <div className="space-y-3 p-4 md:p-8"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
    }

    return (
        <div className="max-w-2xl p-4 md:p-8">
            <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">Your account</h2>

                <p className="text-sm text-muted-foreground">
                    { account.email } · { account.role === "ADMIN" ? "administrator" : "user" }
                </p>
            </div>

            <Separator className="my-5" />

            <div className="space-y-6">
                <div className="space-y-2">
                    <label className="text-sm font-medium">Name</label>

                    <Input value={name} onChange={event => setName(event.target.value)} />

                    <p className="text-xs text-muted-foreground">
                        What the log and the watchlist call you. It cannot be empty.
                    </p>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium">Your Telegram chat</label>
                        {! account.telegramChatId && <Badge variant="outline">off</Badge>}
                    </div>

                    <Input
                        value={chatId}
                        placeholder="e.g. 123456789"
                        onChange={event => setChatId(event.target.value)}
                    />

                    <p className="text-xs text-muted-foreground">
                        Only about what <b>you</b> put on your watchlist — nobody else&apos;s downloads. Message the
                        bot once, then read the id out of its <code>/getUpdates</code>. Empty turns it off. The bot
                        itself is the install&apos;s, so an administrator has to have set one up.
                    </p>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">What to send you</label>

                    <TagInput value={events} onChange={setEvents} placeholder="event" />

                    <p className="text-xs text-muted-foreground">
                        { EVENTS } — or <code>*</code> for all of them. Empty sends nothing.
                    </p>
                </div>

                <Button className="cursor-pointer" onClick={save} disabled={isSaving || ! name.trim()}>
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isSaving })} />
                    <Save className={classNames({ "hidden": isSaving })} />
                    Save
                </Button>
            </div>

            {account.hasPassword && <>
                <Separator className="my-8" />

                <div className="space-y-4">
                    <div className="space-y-1">
                        <h3 className="text-lg font-medium">Password</h3>

                        <p className="text-sm text-muted-foreground">
                            The old one is asked for even though you are signed in. Changing it signs out every
                            other browser.
                        </p>
                    </div>

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

                    <Button
                        variant="outline"
                        className="cursor-pointer"
                        onClick={changePassword}
                        disabled={isChanging || ! current || ! next}
                    >
                        <Loader2 className={classNames("animate-spin", { "hidden": ! isChanging })} />
                        Change it
                    </Button>
                </div>
            </>}

            {account.linkedToProvider && ! account.hasPassword && <>
                <Separator className="my-8" />

                <p className="text-sm text-muted-foreground">
                    This account signs in through the identity provider and has no password here. An administrator
                    can give it one.
                </p>
            </>}
        </div>
    );
}
