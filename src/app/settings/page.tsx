'use client';

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

type SettingItem = {
    key: string;
    group: string;
    label: string;
    type: "string" | "number" | "boolean" | "list" | "table";
    secret: boolean;
    help: string;
    placeholder: string;
    source: "database" | "env" | "unset";
    value: string;
    isSet: boolean;
};

const SOURCE: Record<SettingItem["source"], { text: string, variant: "default" | "secondary" | "outline" }> = {
    database: { text: "saved here", variant: "default" },
    env: { text: "from .env", variant: "secondary" },
    unset: { text: "not set", variant: "outline" }
};

const isOn = (value: string) => value.trim() === "1" || value.trim().toLowerCase() === "true";

export default function Page() {
    const [ items, setItems ] = useState<SettingItem[]>();
    const [ values, setValues ] = useState<Record<string, string>>({});
    const [ isSaving, setSaving ] = useState(false);

    const load = (data: { settings: SettingItem[] }) => {
        setItems(data.settings);
        setValues(Object.fromEntries(data.settings.map(item => [ item.key, item.value ])));
    };

    useEffect(() => {
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

    /** Removing the override, which is the same thing as going back to what .env says. */
    const reset = async (item: SettingItem) => {
        try {
            const res = await axios.delete("/api/settings", { params: { key: item.key } });

            load(res.data);
            toast(`${ item.label } follows the environment again.`);

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

    return (
        <div className="p-4 md:p-8">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                        Admin settings. Anything saved here overrides the environment; clearing a field
                        hands it back to <code className="text-xs">.env</code>. Changes take effect on the
                        next search or scan round — no restart.
                    </p>
                </div>

                <Button className="shrink-0 cursor-pointer" onClick={save} disabled={isSaving || dirtyCount === 0}>
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isSaving })} />
                    <Save className={classNames({ "hidden": isSaving })} />
                    { dirtyCount > 0 ? `Save ${ dirtyCount } change${ dirtyCount === 1 ? "" : "s" }` : "Save" }
                </Button>
            </div>

            <Separator className="my-5" />

            <div className="space-y-10">
                {groups.map(group => (
                    <section key={group}>
                        <h3 className="text-lg font-semibold tracking-tight">{ group }</h3>

                        <div className="mt-1 divide-y">
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
                                            title="Clear the override and follow .env again"
                                            onClick={() => reset(item)}
                                        >
                                            <RotateCcw />
                                        </Button>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
