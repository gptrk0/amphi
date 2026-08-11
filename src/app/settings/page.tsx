'use client';

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Copy, Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OptionCheckboxes } from "@/components/option-checkboxes";
import { TagInput } from "@/components/tag-input";
import { AdminOnly } from "@/components/admin-only";
import { useLocale } from "@/context/locale";
import { MessageKey } from "@/i18n";
import { settingGroup, settingHelp, settingLabel, settingPlaceholder } from "@/lib/setting-labels";

type SettingItem = {
    key: string;
    group: string;
    label: string;
    type: "string" | "number" | "boolean" | "list" | "table";
    // only decides how the log writes about it — the value itself is shown here, see
    // the comment on `toItem` in the api route
    secret: boolean;
    ordered: boolean;
    // a list that can only hold these: ticked instead of typed
    options: { value: string, label: string, help?: string }[];
    help: string;
    placeholder: string;
    default: string;
    hasDefault: boolean;
    source: "database" | "default" | "unset";
    value: string;
    isSet: boolean;
};

// the derived address the provider has to be told about, which is not a setting and
// cannot be one — see the note on `state` in the api route
type OidcInfo = { callbackUrl: string, fromPublicUrl: boolean };

const SOURCE: Record<SettingItem["source"], { text: MessageKey, variant: "default" | "secondary" | "outline" }> = {
    database: { text: "settingsPage.source.database", variant: "default" },
    default: { text: "settingsPage.source.default", variant: "secondary" },
    unset: { text: "settingsPage.source.unset", variant: "outline" }
};

const isOn = (value: string) => value.trim() === "1" || value.trim().toLowerCase() === "true";

const slug = (group: string) => group.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function SettingsPage() {
    const { locale, t, tOr } = useLocale();

    // a size table entry is `resolution:gb`, and half an entry silently drops out of the
    // parsed table instead of failing. Inside the component, because what it says back is
    // a sentence and sentences have a language
    const tableEntry = (tag: string) => {
        const [ name, size, ...rest ] = tag.split(":");

        if (! name || ! size || rest.length > 0 || ! Number.isFinite(Number(size))) {
            return t("settingsPage.tableHint");
        }

        return null;
    };

    /** What this setting is called and what it says about itself, in the reader's language. */
    const label = (item: SettingItem) => settingLabel(locale, item.key, item.label);
    const help = (item: SettingItem) => settingHelp(locale, item.key, item.help);
    const [ items, setItems ] = useState<SettingItem[]>();
    const [ oidc, setOidc ] = useState<OidcInfo>();
    const [ values, setValues ] = useState<Record<string, string>>({});
    const [ isSaving, setSaving ] = useState(false);
    const [ tab, setTab ] = useState("");

    const load = (data: { settings: SettingItem[], oidc?: OidcInfo }) => {
        setItems(data.settings);
        setOidc(data.oidc);
        setValues(Object.fromEntries(data.settings.map(item => [ item.key, item.value ])));
    };

    // http on a bare ip has no clipboard api at all, and a button that silently does
    // nothing is worse than one that says to select the text
    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast(t("settingsPage.callback.copied"));

        } catch {
            toast(t("settingsPage.callback.copyFailed"));
        }
    };

    useEffect(() => {
        // the hash keeps a reload, and a link, on the same tab
        setTab(window.location.hash.replace("#", ""));

        axios.get("/api/settings")
            .then(res => load(res.data))
            .catch(err => {
                console.error(err);
                toast(t("settingsPage.readFailed"));
            });
    }, [ t ]);

    // only what actually changed is sent, secrets included: the field holds the real
    // value now, so an untouched one compares equal and never reaches the api
    const dirty = useMemo(() => {
        if (! items) {
            return {};
        }

        return Object.fromEntries(items
            .filter(item => (values[item.key] ?? "") !== item.value)
            .map(item => [ item.key, values[item.key] ?? "" ]));
    }, [ items, values ]);

    const dirtyCount = Object.keys(dirty).length;

    const dirtyGroups = useMemo(() => new Set((items || [])
        .filter(item => item.key in dirty)
        .map(item => item.group)), [ items, dirty ]);

    const save = async () => {
        if (dirtyCount === 0) {
            return;
        }

        setSaving(true);

        try {
            const res = await axios.put("/api/settings", { values: dirty });

            load(res.data);
            toast(t(res.data.changed === 1 ? "settingsPage.savedOne" : "settingsPage.saved", { n: res.data.changed }));

        } catch(err) {
            console.error(err);
            toast(axios.isAxiosError(err) && err.response?.data?.message || t("settingsPage.saveFailed"));

        } finally {
            setSaving(false);
        }
    };

    /** Deleting the row, which is the same thing as going back to the default. */
    const reset = async (item: SettingItem) => {
        // for a key with a default this is harmless. For one without — an api key, a
        // password, a url — there is nothing to fall back to and nothing to undo it with,
        // so a misclick would cost the value itself. That happened once already.
        if (! item.hasDefault && ! window.confirm(t("settingsPage.clearConfirm", { label: label(item) }))) {
            return;
        }

        try {
            const res = await axios.delete("/api/settings", { params: { key: item.key } });

            load(res.data);
            toast(t(item.hasDefault ? "settingsPage.backToDefault" : "settingsPage.cleared", { label: label(item) }));

        } catch(err) {
            console.error(err);
            toast(t("settingsPage.clearFailed"));
        }
    };

    const groups = useMemo(() => [ ...new Set((items || []).map(item => item.group)) ], [ items ]);

    if (! items) {
        return (
            <div className="space-y-6 p-4 md:p-8">
                <Skeleton className="h-8 w-64" />
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
        );
    }

    const field = (item: SettingItem) => {
        const value = values[item.key] ?? "";
        const set = (next: string) => setValues(prev => ({ ...prev, [item.key]: next }));

        if (item.type === "boolean") {
            return (
                <div className="flex h-9 items-center gap-3">
                    <Switch
                        className="cursor-pointer"
                        checked={isOn(value)}
                        onCheckedChange={(checked) => set(checked ? "1" : "0")}
                    />
                    <span className="text-sm text-muted-foreground">{ t(isOn(value) ? "settingsPage.on" : "settingsPage.off") }</span>
                </div>
            );
        }

        // a fixed set of values is ticked rather than typed: a misspelt event was
        // accepted, stored, and then quietly sent nothing
        if (item.options.length > 0) {
            return <OptionCheckboxes value={value} onChange={set} options={item.options} />;
        }

        if (item.type === "list" || item.type === "table") {
            return (
                <TagInput
                    value={value}
                    onChange={set}
                    ordered={item.ordered}
                    placeholder={settingPlaceholder(locale, item.key, item.placeholder)}
                    validate={item.type === "table" ? tableEntry : undefined}
                />
            );
        }

        return (
            <Input
                type="text"
                inputMode={item.type === "number" ? "numeric" : undefined}
                value={value}
                placeholder={settingPlaceholder(locale, item.key, item.placeholder)}
                autoComplete="off"
                onChange={(e) => set(e.target.value)}
            />
        );
    };

    const active = groups.find(group => slug(group) === tab) || groups[0];

    return (
        <div className="p-4 md:p-8">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">{ t("settingsPage.title") }</h2>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                        { t("settingsPage.intro") }
                    </p>
                </div>

                <Button className="shrink-0 cursor-pointer" onClick={save} disabled={isSaving || dirtyCount === 0}>
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isSaving })} />
                    <Save className={classNames({ "hidden": isSaving })} />
                    { dirtyCount === 0 ? t("settingsPage.save") : t(dirtyCount === 1 ? "settingsPage.saveOne" : "settingsPage.saveCount", { n: dirtyCount }) }
                </Button>
            </div>

            <Separator className="my-5" />

            <Tabs
                value={active}
                onValueChange={(next) => {
                    setTab(slug(next));
                    window.history.replaceState(null, "", `#${ slug(next) }`);
                }}
            >
                <TabsList className="h-auto flex-wrap justify-start">
                    {groups.map(group => (
                        <TabsTrigger key={group} value={group} className="cursor-pointer">
                            { settingGroup(group, tOr) }

                            {dirtyGroups.has(group) && <span className="bg-primary size-1.5 rounded-full" />}
                        </TabsTrigger>
                    ))}
                </TabsList>

                {groups.map(group => (
                    <TabsContent key={group} value={group}>
                        {group === "Access" && oidc && (
                            <div className="mt-4 space-y-2 rounded-md border bg-muted/40 p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium">{ t("settingsPage.callback.label") }</span>

                                    <Badge variant={oidc.fromPublicUrl ? "default" : "secondary"}>
                                        { t(oidc.fromPublicUrl ? "settingsPage.callback.fromPublic" : "settingsPage.callback.fromRequest") }
                                    </Badge>
                                </div>

                                <div className="flex items-start gap-2">
                                    <code className="bg-background min-w-0 flex-1 rounded border px-2 py-1.5 text-xs break-all">
                                        { oidc.callbackUrl }
                                    </code>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="cursor-pointer"
                                        onClick={() => copy(oidc.callbackUrl)}
                                    >
                                        <Copy />
                                        { t("settingsPage.callback.copy") }
                                    </Button>
                                </div>

                                <p className="text-xs text-muted-foreground">
                                    { t("settingsPage.callback.note") }
                                    {! oidc.fromPublicUrl && t("settingsPage.callback.guessed")}
                                </p>
                            </div>
                        )}

                        <div className="divide-y">
                            {items.filter(item => item.group === group).map(item => (
                                <div
                                    key={item.key}
                                    className="grid gap-2 py-4 md:grid-cols-[minmax(0,22rem)_1fr] md:items-start md:gap-8"
                                >
                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium">{ label(item) }</span>
                                            <Badge variant={SOURCE[item.source].variant}>{ t(SOURCE[item.source].text) }</Badge>
                                        </div>

                                        {help(item) && <p className="text-xs text-muted-foreground">{ help(item) }</p>}

                                        <code className="text-[11px] text-muted-foreground">{ item.key }</code>
                                    </div>

                                    <div className="flex items-start gap-2">
                                        <div className="min-w-0 flex-1">{ field(item) }</div>

                                        {item.source === "database" && <Button
                                            variant="ghost"
                                            size="sm"
                                            className="cursor-pointer"
                                            title={item.hasDefault
                                                ? (item.default ? t("settingsPage.resetTitleValue", { value: item.default }) : t("settingsPage.resetTitle"))
                                                : t("settingsPage.clearTitle", { label: label(item) })}
                                            onClick={() => reset(item)}
                                        >
                                            { item.hasDefault ? <RotateCcw /> : <Trash2 className="text-destructive" /> }
                                        </Button>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}

export default function Page() {
    const { t } = useLocale();

    return (
        <AdminOnly title={t("settingsPage.title")}>
            <SettingsPage />
        </AdminOnly>
    );
}
