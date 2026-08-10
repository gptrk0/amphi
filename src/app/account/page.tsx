'use client';

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Save, Send } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { OptionCheckboxes } from "@/components/option-checkboxes";
import { OptionSelect } from "@/components/option-select";
import { TagInput } from "@/components/tag-input";
import { useSession } from "@/context/session";
import { LANGUAGE_OPTIONS } from "@/types/language";
import { NOTIFY_EVENTS } from "@/types/notify";

type Account = {
    id: number;
    email: string;
    name: string;
    role: "ADMIN" | "USER";
    hasPassword: boolean;
    linkedToProvider: boolean;
    webhookUrl: string;
    notifyEvents: string;
    preferredLanguages: string;
    excludeLanguages: string;
    defaultLanguage: string;
    languageFirst: boolean;
};

// what to paste, for the two services anybody actually uses
const EXAMPLES = [
    {
        name: "Telegram",
        url: "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT>&text={message}"
    },
    {
        name: "Discord",
        url: "https://discord.com/api/webhooks/<id>/<token>"
    }
];

/**
 * The settings that are yours rather than the install's. The admin page decides how
 * the app behaves; this decides how it behaves towards you — what you are called and
 * where you hear about your own downloads.
 */
export default function Page() {
    const { refresh } = useSession();

    const [ account, setAccount ] = useState<Account>();
    const [ name, setName ] = useState("");
    const [ webhook, setWebhook ] = useState("");
    const [ events, setEvents ] = useState("");
    const [ languages, setLanguages ] = useState("");
    const [ excluded, setExcluded ] = useState("");
    const [ untagged, setUntagged ] = useState("");
    const [ languageFirst, setLanguageFirst ] = useState(true);
    const [ isSaving, setSaving ] = useState(false);
    const [ isTesting, setTesting ] = useState(false);

    const load = (data: Account) => {
        setAccount(data);
        setName(data.name);
        setWebhook(data.webhookUrl);
        setEvents(data.notifyEvents);
        setLanguages(data.preferredLanguages);
        setExcluded(data.excludeLanguages);
        setUntagged(data.defaultLanguage);
        setLanguageFirst(data.languageFirst);
    };

    useEffect(() => {
        axios.get("/api/auth/me")
            .then(res => load(res.data.account))
            .catch(err => console.error(err));
    }, [])

    const save = async () => {
        setSaving(true);

        try {
            await axios.patch("/api/auth/me", {
                name,
                webhookUrl: webhook,
                notifyEvents: events,
                preferredLanguages: languages,
                excludeLanguages: excluded,
                defaultLanguage: untagged,
                languageFirst
            });

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

    /** Sends the field as it is on screen, so a typo shows up before it is saved. */
    const test = async () => {
        setTesting(true);

        try {
            const res = await axios.post("/api/auth/me/test", { webhookUrl: webhook });

            toast(res.data.message);

        } catch(err) {
            toast((axios.isAxiosError(err) ? err.response?.data?.message : null) || "The webhook could not be called.");

        } finally {
            setTesting(false);
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
                        <label className="text-sm font-medium">Your webhook</label>
                        {! account.webhookUrl && <Badge variant="outline">off</Badge>}
                    </div>

                    <div className="flex gap-2">
                        <Input
                            value={webhook}
                            placeholder="https://…"
                            onChange={event => setWebhook(event.target.value)}
                        />

                        <Button
                            variant="outline"
                            className="shrink-0 cursor-pointer"
                            onClick={test}
                            disabled={isTesting || ! webhook.trim()}
                        >
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isTesting })} />
                            <Send className={classNames({ "hidden": isTesting })} />
                            Test
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        A URL the app calls when something of <b>yours</b> happens — never anybody else&apos;s
                        downloads. Put <code>{"{message}"}</code> in it and it is fetched with the text filled in;
                        leave it without one and it is posted to as JSON (<code>content</code>), which is what a
                        Discord webhook wants. <code>{"{title}"}</code>, <code>{"{detail}"}</code> and{" "}
                        <code>{"{event}"}</code> are the other placeholders. Empty turns it off.
                    </p>

                    <div className="space-y-1 rounded-md border p-3">
                        {EXAMPLES.map(example => (
                            <div key={example.name} className="flex flex-wrap items-baseline gap-2 text-xs">
                                <span className="w-16 shrink-0 font-medium">{ example.name }</span>

                                <button
                                    type="button"
                                    className="cursor-pointer break-all text-left font-mono text-muted-foreground hover:text-foreground"
                                    onClick={() => setWebhook(example.url)}
                                    title="Use this as a starting point"
                                >
                                    { example.url }
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">What to send you</label>

                    <OptionCheckboxes value={events} onChange={setEvents} options={NOTIFY_EVENTS} />

                    <p className="text-xs text-muted-foreground">
                        Only ever about your own downloads. Nothing ticked sends nothing, and so does an
                        empty webhook above.
                    </p>
                </div>

                <Separator />

                <div className="space-y-2">
                    <label className="text-sm font-medium">Languages you want, best first</label>

                    <TagInput
                        value={languages}
                        onChange={setLanguages}
                        ordered
                        options={LANGUAGE_OPTIONS}
                        noun="language"
                        placeholder="pick a language"
                    />

                    <p className="text-xs text-muted-foreground">
                        <b>The first one is the only language downloaded for you on its own.</b> If a release
                        in it does not exist yet, the title stays on your watchlist and is looked for again —
                        the rest of the list is only offered when you start a download by hand, and taking one
                        of those is a question you have to answer. Somebody else&apos;s copy in another language
                        does not count as yours: you each get your own file.
                    </p>
                </div>

                <div className="max-w-sm space-y-2">
                    <label className="text-sm font-medium">Untagged release counts as</label>

                    <OptionSelect
                        value={untagged}
                        onChange={setUntagged}
                        options={LANGUAGE_OPTIONS}
                        noun="language"
                    />

                    <p className="text-xs text-muted-foreground">
                        Most releases carry no language tag at all. This is what they are taken to be —
                        and with a first language that is not this, an untagged release is not yours.
                    </p>
                </div>

                <div className="space-y-2">
                    {/* the app's own checkbox, like every other one — a raw input here was
                        the browser's, and looked like it */}
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                        <Checkbox
                            className="cursor-pointer"
                            checked={languageFirst}
                            onCheckedChange={(checked) => setLanguageFirst(checked === true)}
                        />
                        Language outranks resolution
                    </label>

                    <p className="text-xs text-muted-foreground">
                        On, which is how a new account starts: a 720p release in your language beats a
                        1080p one that is not. Off means the sharpest copy wins and the language is only
                        a tie-breaker — there is no setting between the two, because a language that
                        merely counts for something is a language that loses to a few more seeders.
                    </p>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">Languages you never want</label>

                    <TagInput
                        value={excluded}
                        onChange={setExcluded}
                        options={LANGUAGE_OPTIONS}
                        noun="language"
                        placeholder="pick a language"
                    />

                    <p className="text-xs text-muted-foreground">
                        Only applies to what you start by hand, and never to a release in the title&apos;s own
                        original language — otherwise a Japanese film would become unobtainable.
                    </p>
                </div>

                <Button className="cursor-pointer" onClick={save} disabled={isSaving || ! name.trim()}>
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isSaving })} />
                    <Save className={classNames({ "hidden": isSaving })} />
                    Save
                </Button>
            </div>

            {/* The password is changed in the dialog behind "Change password" in the user
                menu, which is reachable from every page — a second form for it here was two
                places to keep the same rules in, and the one on a page you have to navigate
                to was the worse of them. */}

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
