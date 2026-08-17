'use client';

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, Send } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { OptionCheckboxes } from "@/components/option-checkboxes";
import { TagInput } from "@/components/tag-input";
import { WebhookExamples } from "@/components/webhook-examples";
import { useLocale } from "@/context/locale";
import { useSession } from "@/context/session";
import { useLanguageOptions } from "@/lib/language-labels";
import { useNotifyOptions } from "@/lib/notify-labels";

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
    languageFirst: boolean;
    acceptAnyLanguage: boolean;
};

/**
 * The settings that are somebody's rather than the install's. The admin page decides how
 * the app behaves; this decides how it behaves towards one person — what they are called
 * and where they hear about their own downloads.
 *
 * One form, two doors. Without `userId` it is your own account and talks to
 * `/api/auth/me`. With one it is somebody else's, opened by an administrator from the
 * users list, and talks to `/api/users/[id]/account` — which is the same fields under the
 * same rules, minus the password. A second copy of this form for the admin case would be
 * a second place for every language rule to be explained slightly differently in.
 */
export function AccountSettings({ userId }: { userId?: number }) {
    const { state, refresh } = useSession();
    const { t } = useLocale();
    const languageOptions = useLanguageOptions();
    const notifyOptions = useNotifyOptions();

    const [ account, setAccount ] = useState<Account>();
    const [ name, setName ] = useState("");
    const [ webhook, setWebhook ] = useState("");
    const [ events, setEvents ] = useState("");
    const [ languages, setLanguages ] = useState("");
    const [ excluded, setExcluded ] = useState("");
    const [ languageFirst, setLanguageFirst ] = useState(true);
    const [ acceptAny, setAcceptAny ] = useState(false);
    const [ isSaving, setSaving ] = useState(false);
    const [ isTesting, setTesting ] = useState(false);
    const [ isMissing, setMissing ] = useState(false);

    // your own page even when it was reached through the users list, which is worth
    // getting right: it decides whether the header says "yours" and whether the signed
    // in session has to be told the name changed
    const isMine = ! userId || userId === state?.user?.id;
    const endpoint = userId ? `/api/users/${ userId }/account` : "/api/auth/me";

    const load = (data: Account) => {
        setAccount(data);
        setName(data.name);
        setWebhook(data.webhookUrl);
        setEvents(data.notifyEvents);
        setLanguages(data.preferredLanguages);
        setExcluded(data.excludeLanguages);
        setLanguageFirst(data.languageFirst);
        setAcceptAny(data.acceptAnyLanguage);
    };

    useEffect(() => {
        setMissing(false);

        axios.get(endpoint)
            .then(res => load(res.data.account))
            // an id that is not anybody's — a stale link, a deleted account. Said out
            // loud, because the alternative is a skeleton that never finishes.
            .catch(err => { console.error(err); setMissing(true); });
    }, [ endpoint ])

    const save = async () => {
        setSaving(true);

        try {
            await axios.patch(endpoint, {
                name,
                webhookUrl: webhook,
                notifyEvents: events,
                preferredLanguages: languages,
                excludeLanguages: excluded,
                languageFirst,
                acceptAnyLanguage: acceptAny
            });

            const res = await axios.get(endpoint);

            load(res.data.account);

            if (isMine) {
                await refresh();
            }

            toast(t("account.saved"));

        } catch(err) {
            toast((axios.isAxiosError(err) ? err.response?.data?.message : null) || t("account.saveFailed"));

        } finally {
            setSaving(false);
        }
    };

    /** Sends the field as it is on screen, so a typo shows up before it is saved. */
    const test = async () => {
        setTesting(true);

        try {
            const res = await axios.post(`${ endpoint }/test`, { webhookUrl: webhook });

            toast(res.data.message);

        } catch(err) {
            toast((axios.isAxiosError(err) ? err.response?.data?.message : null) || t("webhook.failed"));

        } finally {
            setTesting(false);
        }
    };

    const back = userId ? (
        <Link
            href="/users"
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
            <ArrowLeft className="size-4" />
            { t("account.backToUsers") }
        </Link>
    ) : null;

    if (isMissing) {
        return (
            <div className="p-4 md:p-8">
                { back }

                <p className="text-sm text-muted-foreground">{ t("account.missing") }</p>
            </div>
        );
    }

    if (! account) {
        return <div className="space-y-3 p-4 md:p-8"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
    }

    return (
        <div className="max-w-2xl p-4 md:p-8">
            { back }

            <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">
                    { isMine ? t("account.title") : t("account.titleFor", { name: account.name }) }
                </h2>

                <p className="text-sm text-muted-foreground">
                    { t("account.who", { email: account.email, role: account.role === "ADMIN" ? t("userMenu.administrator") : t("userMenu.user") }) }
                </p>
            </div>

            {/* said once, at the top: every hint below this is written to the person whose
                settings these are, and an administrator reading "your downloads" should
                know whose they are */}
            {! isMine && <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">
                { t("account.forSomebodyElse", { name: account.name }) }
            </p>}

            <Separator className="my-5" />

            <div className="space-y-6">
                <div className="space-y-2">
                    <label className="text-sm font-medium">{ t("account.name") }</label>

                    <Input value={name} onChange={event => setName(event.target.value)} />

                    <p className="text-xs text-muted-foreground">{ t("account.nameHint") }</p>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium">{ t("account.webhook") }</label>
                        {! account.webhookUrl && <Badge variant="outline">{ t("account.webhookOff") }</Badge>}
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
                            { t("webhook.test") }
                        </Button>
                    </div>

                    {/* the placeholders stay in the sentence rather than being marked up:
                        one translated string is one thing to keep right, and `{message}`
                        reads as a placeholder without a `<code>` around it */}
                    <p className="text-xs text-muted-foreground">{ t("account.webhookHint") }</p>

                    <WebhookExamples onPick={setWebhook} />
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">{ t("account.events") }</label>

                    <OptionCheckboxes value={events} onChange={setEvents} options={notifyOptions} />

                    <p className="text-xs text-muted-foreground">{ t("account.eventsHint") }</p>
                </div>

                <Separator />

                <div className="space-y-2">
                    <label className="text-sm font-medium">{ t("account.languages") }</label>

                    <TagInput
                        value={languages}
                        onChange={setLanguages}
                        ordered
                        options={languageOptions}
                        placeholder={t("account.pickLanguage")}
                    />

                    <p className="text-xs text-muted-foreground">
                        <b>{ t(acceptAny ? "account.languagesHintAny" : "account.languagesHintFirst") }</b>
                        {" "}{ t("account.languagesHintShared") }
                    </p>

                    <div className="flex items-start gap-3 rounded-md border p-3">
                        <Switch
                            className="mt-0.5 cursor-pointer"
                            checked={acceptAny}
                            onCheckedChange={setAcceptAny}
                        />

                        <div className="space-y-1">
                            <label className="text-sm font-medium">{ t("account.acceptAny") }</label>

                            <p className="text-xs text-muted-foreground">{ t("account.acceptAnyHint") }</p>
                        </div>
                    </div>
                </div>

                {/* "Untagged release counts as" was here until 2026-08-16. It is one answer
                    for the install now (Settings / Quality), because it never was a
                    preference: everything else on this page says what you want, that one
                    says what a file is. */}

                <div className="space-y-2">
                    {/* the app's own checkbox, like every other one — a raw input here was
                        the browser's, and looked like it */}
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                        <Checkbox
                            className="cursor-pointer"
                            checked={languageFirst}
                            onCheckedChange={(checked) => setLanguageFirst(checked === true)}
                        />
                        { t("account.languageFirst") }
                    </label>

                    <p className="text-xs text-muted-foreground">
                        { t("account.languageFirstHint") }
                    </p>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">{ t("account.excluded") }</label>

                    <TagInput
                        value={excluded}
                        onChange={setExcluded}
                        options={languageOptions}
                        placeholder={t("account.pickLanguage")}
                    />

                    <p className="text-xs text-muted-foreground">
                        { t("account.excludedHint") }
                    </p>
                </div>

                <Button className="cursor-pointer" onClick={save} disabled={isSaving || ! name.trim()}>
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isSaving })} />
                    <Save className={classNames({ "hidden": isSaving })} />
                    { t("common.save") }
                </Button>
            </div>

            {/* The password is changed in the dialog behind "Change password" in the user
                menu, which is reachable from every page — a second form for it here was two
                places to keep the same rules in, and the one on a page you have to navigate
                to was the worse of them. Somebody else's is set from the users list, for the
                same reason: it signs their browsers out, which is not a thing to do halfway
                down a form about languages. */}

            {account.linkedToProvider && ! account.hasPassword && <>
                <Separator className="my-8" />

                <p className="text-sm text-muted-foreground">
                    { isMine ? t("account.providerOnly") : t("account.providerOnlyTheirs") }
                </p>
            </>}
        </div>
    );
}
