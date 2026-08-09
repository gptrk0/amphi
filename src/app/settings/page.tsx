'use client';

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TagInput } from "@/components/tag-input";
import { AdminOnly } from "@/components/admin-only";

type SettingItem = {
    key: string;
    group: string;
    label: string;
    type: "string" | "number" | "boolean" | "list" | "table";
    secret: boolean;
    ordered: boolean;
    help: string;
    placeholder: string;
    default: string;
    hasDefault: boolean;
    source: "database" | "default" | "unset";
    value: string;
    isSet: boolean;
};

const SOURCE: Record<SettingItem["source"], { text: string, variant: "default" | "secondary" | "outline" }> = {
    database: { text: "edited", variant: "default" },
    default: { text: "default", variant: "secondary" },
    unset: { text: "not set", variant: "outline" }
};

const isOn = (value: string) => value.trim() === "1" || value.trim().toLowerCase() === "true";

const slug = (group: string) => group.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// a size table entry is `resolution:gb`, and half an entry silently drops out of the
// parsed table instead of failing
const tableEntry = (tag: string) => {
    const [ name, size, ...rest ] = tag.split(":");

    if (! name || ! size || rest.length > 0 || ! Number.isFinite(Number(size))) {
        return "Write it as 1080p:2 — a resolution and its size in GB.";
    }

    return null;
};

function SettingsPage() {
    const [ items, setItems ] = useState<SettingItem[]>();
    const [ values, setValues ] = useState<Record<string, string>>({});
    const [ isSaving, setSaving ] = useState(false);
    const [ tab, setTab ] = useState("");

    const load = (data: { settings: SettingItem[] }) => {
        setItems(data.settings);
        setValues(Object.fromEntries(data.settings.map(item => [ item.key, item.value ])));
    };

    useEffect(() => {
        // the hash keeps a reload, and a link, on the same tab
        setTab(window.location.hash.replace("#", ""));

        axios.get("/api/settings")
            .then(res => load(res.data))
            .catch(err => {
                console.error(err);
                toast("Could not read the settings.");
            });
    }, []);

    // only what actually changed is sent; a secret left alone stays untouched because
    // the api treats an empty secret as "no change"
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
            toast(`${ res.data.changed } setting${ res.data.changed === 1 ? "" : "s" } saved.`);

        } catch(err) {
            console.error(err);
            toast(axios.isAxiosError(err) && err.response?.data?.message || "Could not save the settings.");

        } finally {
            setSaving(false);
        }
    };

    /** Deleting the row, which is the same thing as going back to the default. */
    const reset = async (item: SettingItem) => {
        // for a key with a default this is harmless. For one without — an api key, a
        // password, a url — there is nothing to fall back to and nothing to undo it with,
        // so a misclick would cost the value itself. That happened once already.
        if (! item.hasDefault && ! window.confirm(`Clear ${ item.label }? It has no default to fall back on, so you will have to type it in again.`)) {
            return;
        }

        try {
            const res = await axios.delete("/api/settings", { params: { key: item.key } });

            load(res.data);
            toast(item.hasDefault ? `${ item.label } is back to its default.` : `${ item.label } is cleared.`);

        } catch(err) {
            console.error(err);
            toast("Could not clear the setting.");
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
                    <span className="text-sm text-muted-foreground">{ isOn(value) ? "on" : "off" }</span>
                </div>
            );
        }

        if (item.type === "list" || item.type === "table") {
            return (
                <TagInput
                    value={value}
                    onChange={set}
                    ordered={item.ordered}
                    placeholder={item.placeholder}
                    validate={item.type === "table" ? tableEntry : undefined}
                />
            );
        }

        return (
            <Input
                type={item.secret ? "password" : "text"}
                inputMode={item.type === "number" ? "numeric" : undefined}
                value={value}
                placeholder={item.secret
                    ? (item.isSet ? "set — type to replace" : "not set")
                    : item.placeholder}
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
                    <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                        Everything the app reads lives here — the environment is only used to find the
                        database. A field you have not touched follows its default and is not stored;
                        clearing one hands it back. Changes take effect on the next search or scan
                        round, without a restart.
                    </p>
                </div>

                <Button className="shrink-0 cursor-pointer" onClick={save} disabled={isSaving || dirtyCount === 0}>
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isSaving })} />
                    <Save className={classNames({ "hidden": isSaving })} />
                    { dirtyCount > 0 ? `Save ${ dirtyCount } change${ dirtyCount === 1 ? "" : "s" }` : "Save" }
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
                            { group }

                            {dirtyGroups.has(group) && <span className="bg-primary size-1.5 rounded-full" />}
                        </TabsTrigger>
                    ))}
                </TabsList>

                {groups.map(group => (
                    <TabsContent key={group} value={group}>
                        <div className="divide-y">
                            {items.filter(item => item.group === group).map(item => (
                                <div
                                    key={item.key}
                                    className="grid gap-2 py-4 md:grid-cols-[minmax(0,22rem)_1fr] md:items-start md:gap-8"
                                >
                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium">{ item.label }</span>
                                            <Badge variant={SOURCE[item.source].variant}>{ SOURCE[item.source].text }</Badge>
                                        </div>

                                        {item.help && <p className="text-xs text-muted-foreground">{ item.help }</p>}

                                        <code className="text-[11px] text-muted-foreground">{ item.key }</code>
                                    </div>

                                    <div className="flex items-start gap-2">
                                        <div className="min-w-0 flex-1">{ field(item) }</div>

                                        {item.source === "database" && <Button
                                            variant="ghost"
                                            size="sm"
                                            className="cursor-pointer"
                                            title={item.hasDefault
                                                ? `Back to the default${ item.default ? `: ${ item.default }` : "" }`
                                                : `Clear ${ item.label } — there is no default to fall back on`}
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
    return (
        <AdminOnly title="Settings">
            <SettingsPage />
        </AdminOnly>
    );
}
